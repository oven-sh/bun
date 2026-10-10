use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, has_jsx_prop_ignore_case, is_undefined,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::get_inner_expression;

/// The lang prop on the `<html>` element must be a valid IETF BCP 47 language tag.
pub struct Lang;

const LANG: Message = Message::new("", "`lang` attribute must have a valid value.");

impl Rule for Lang {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "lang", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        Lang
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        if *get_element_type(cx.file(), jsx_el) != *b"html" {
            return;
        }
        match has_jsx_prop_ignore_case(jsx_el, "lang") {
            Some(lang_prop) if is_valid_lang_prop(lang_prop) => {}
            Some(lang_prop) => {
                cx.report(lang_prop, LANG);
            }
            None => {
                if let Some(name) = jsx_el.tag() {
                    cx.report(name, LANG);
                }
            }
        }
    }
}

fn is_valid_lang_prop(item: Prop) -> bool {
    let is_valid = |value: &[u8]| is_valid_language_tag(&value.to_ascii_lowercase());
    match get_prop_value(item) {
        Some(AttributeValue::ExpressionContainer(e)) if !e.is_missing() => match get_inner_expression(e).kind() {
            ExprKind::String(value) => is_valid(value.bytes()),
            ExprKind::Template(template) if template.exprs().is_empty() => {
                template.cooked(0).is_none_or(|value| is_valid(value.bytes()))
            }
            _ => !is_undefined(e),
        },
        Some(AttributeValue::StringLiteral(literal)) => is_valid(literal.value),
        _ => true,
    }
}

/// What is read last.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum After {
    /// A language of two or three letters, and its extended language.
    Language,
    /// A longer language.
    LongLanguage,
    Script,
    /// Also a variant.
    Region,
    Extension,
    PrivateUse,
}

/// `LanguageTag::parse(tag).is_ok_and(LanguageTag::is_valid)` of the crate `language-tags` 0.3.2: well-formed as RFC 5646 has it,
/// every subtag registered, an extended language and a variant after what the registry says they go with, no more than one extended
/// language, no variant and no extension twice. `tag`: in lower case.
fn is_valid_language_tag(tag: &[u8]) -> bool {
    if strings::split(GRANDFATHERED.as_bytes(), b" ").any(|it| it == tag) {
        return true;
    }
    if let Some(private_use) = tag.strip_prefix(b"x-") {
        return !private_use.is_empty() && private_use.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'-');
    }
    let is_alphabetic = |subtag: &[u8]| subtag.iter().all(u8::is_ascii_alphabetic);
    let starts_with = |prefix: &[u8]| tag.strip_prefix(prefix).is_some_and(|rest| rest.first() == Some(&b'-'));
    let mut subtags = strings::split(tag, b"-");
    let Some(language) = subtags.next().filter(|it| (2..=8).contains(&it.len()) && is_alphabetic(it)) else {
        return false;
    };
    if !between(language, "qaa", "qtz") && !(language.len() <= 3 && has_code(&LANGUAGES, language)) {
        return false;
    }
    let mut after = if language.len() < 4 { After::Language } else { After::LongLanguage };
    // Whether an extension or what is for private use has nothing yet.
    let mut is_empty = false;
    let (mut has_extended_language, mut variants, mut extensions) = (false, 0u128, 0u128);
    for subtag in subtags {
        if !(1..=8).contains(&subtag.len()) || !subtag.iter().all(u8::is_ascii_alphanumeric) {
            return false;
        }
        match *subtag {
            _ if after == After::PrivateUse => is_empty = false,
            [singleton] => {
                let bit = 1 << singleton;
                if is_empty || extensions & bit != 0 {
                    return false;
                }
                extensions |= bit;
                after = if singleton == b'x' { After::PrivateUse } else { After::Extension };
                is_empty = true;
            }
            _ if after == After::Extension => is_empty = false,
            [_, _, _] if after == After::Language && is_alphabetic(subtag) => {
                let follows = |it: &[u8]| {
                    strings::split_once_char(it, b':')
                        .is_some_and(|(prefix, all)| prefix == language && all.as_chunks::<3>().0.iter().any(|it| it == subtag))
                };
                if has_extended_language || !strings::split(EXTENDED_LANGUAGES.as_bytes(), b" ").any(follows) {
                    return false;
                }
                has_extended_language = true;
            }
            [_, _, _, _] if after <= After::LongLanguage && is_alphabetic(subtag) => {
                if !between(subtag, "qaaa", "qabx") && !SCRIPTS.as_bytes().as_chunks::<4>().0.iter().any(|it| it == subtag) {
                    return false;
                }
                after = After::Script;
            }
            [_, _] if after <= After::Script && is_alphabetic(subtag) => {
                if !between(subtag, "qm", "qz") && !between(subtag, "xa", "xz") && !has_code(&REGIONS, subtag) {
                    return false;
                }
                after = After::Region;
            }
            [b'0'..=b'9', b'0'..=b'9', b'0'..=b'9'] if after <= After::Script => {
                if !NUMERIC_REGIONS.as_bytes().as_chunks::<3>().0.iter().any(|it| it == subtag) {
                    return false;
                }
                after = After::Region;
            }
            [b'a'..=b'z', _, _, _, _, ..] | [b'0'..=b'9', _, _, _, ..] => {
                let registered = strings::split(VARIANTS.as_bytes(), b" ")
                    .map(|it| strings::split_once_char(it, b':').unwrap_or((it, b"".as_slice())));
                let Some((index, (_, prefixes))) = registered.enumerate().find(|(_, it)| it.0 == subtag) else {
                    return false;
                };
                if variants >> index & 1 != 0 || !prefixes.is_empty() && !strings::split(prefixes, b",").any(starts_with) {
                    return false;
                }
                variants |= 1 << index;
                after = After::Region;
            }
            _ => return false,
        }
    }
    !is_empty
}

fn between(subtag: &[u8], first: &str, last: &str) -> bool {
    first.as_bytes() <= subtag && subtag <= last.as_bytes()
}

/// Where the bit for a code of two or three lower case letters is: those of three come after those of two.
fn index_of_code(code: &[u8]) -> usize {
    code.iter().fold(0, |index, b| index * 26 + usize::from(b - b'a')) + if code.len() == 3 { 26 * 26 } else { 0 }
}

fn has_code(codes: &[u64], code: &[u8]) -> bool {
    let index = index_of_code(code);
    codes.get(index / 64).is_some_and(|word| word >> (index % 64) & 1 != 0)
}

// The IANA language subtag registry, with what was added to it until 2021-02-20.

/// A bit for each language, at [`index_of_code`]. Without those for private use.
static LANGUAGES: [u64; 286] = [
    0x091019c747263433, 0x1c68108800045364, 0x4443028094090c84, 0x8004045c6559c690, 0xc00e1850d767f411, 0x61204489a16d0e6d,
    0x0010000003024040, 0x9b7447f7ddd141c0, 0x1001044202044053, 0x4100000020000400, 0xefdfdff040020400, 0xafefffbdbbfffeff,
    0x873976f573c1ff7f, 0xfff03bf70fffffff, 0xffdffe9628505cff, 0xfffffff77ffffff7, 0xfffffe9e3fffffff, 0xfffffbe7a0abc4df,
    0xffffffffff7fffef, 0x49fe75df0f1f42bd, 0x1c93f9feddf20071, 0xfffffffffeebff82, 0xd7fffffffff7ffff, 0xfffff7ff7fffffff,
    0xfffffbfe7fffffff, 0xfbfffffffffeffff, 0xff3ffffdffffffff, 0xffffeffffff6ffbf, 0xffdfffff7fffffbf, 0xeffffffdf7ffffff,
    0xffbdfffffdffffff, 0x7fffffffffffefff, 0xf407fadd5fdbf7ff, 0x04125082c43c19cf, 0xff2ffbb800044500, 0x788349bd64542b49,
    0xc0e7d555617e77bf, 0x85dff9feff37b371, 0xfbfffbc100008653, 0xfc7c73e377ffffff, 0x08005b0008101ffd, 0x2000040030000000,
    0xefedeff7dffd0219, 0xfc1198d640200045, 0xe6ddf000000227bd, 0xffdfffef3d9e526d, 0x0d100860c41149fc, 0x75e99d65f67c7f00,
    0x00000020003efedb, 0xc01699257da77c00, 0x0007f7ffff47bd62, 0x0000003560c01000, 0x001000a16510714b, 0x0600000491110000,
    0x4440000100000001, 0x5000018048010000, 0x5500000042880000, 0x5f553243564102dd, 0x000800003cde2bfd, 0x9170400000000004,
    0x0a798219957dd013, 0x4000000824001000, 0x4004001020000000, 0x20039abfeb000004, 0x0000000040000000, 0x0000004400020000,
    0x5a88310000000020, 0x6042004000000000, 0x000508108000408a, 0x0000000408631080, 0x4081003f50300400, 0x013b33be00000000,
    0x0000000001100800, 0xf000000000000000, 0x283cfdffffffffff, 0x3e51fef27dfffc0a, 0xb2545a6c5b220100, 0x048d403dff9df039,
    0x8db5493e3810e019, 0xdfffff96dff7ff33, 0xf3c1221010008047, 0x40040444f850ffd5, 0x7f41be8d6fffdff0, 0x2797b2000000da33,
    0x0fe7ffff00084070, 0x0800000008104180, 0x000000000011c941, 0x5feb408040040100, 0xc0424910000400ca, 0x8f67ffbfff060006,
    0x01100036edf9f051, 0x882b6b5054000000, 0xffdffe2510400042, 0x0000040050809053, 0x000000c000010000, 0x81448e76c02a1000,
    0x00000078047c0208, 0x0844785244050cc0, 0x1885002200010204, 0x11d3750eeecd1001, 0x0000833eb5906691, 0x4500000001040052,
    0x74781a75dd649964, 0x0800008001000fb9, 0x0010002010045400, 0x9f7ebf8080600804, 0x1040c0000169dc43, 0x0000001a2dd20200,
    0xdf01004000044120, 0x6d00100800413959, 0x24c6290f01000401, 0x8000446004a0102d, 0x0068000c02000020, 0xfd8f000000000080,
    0x000010000080215e, 0x0001000011000000, 0xffffffde3d7ff000, 0xffffeffff7ffffff, 0xffffffffffffffff, 0xffffddbfffffbffd,
    0xffffffffffffefff, 0xfdffffdfffffffff, 0xfffffffffffffdcf, 0xffffffffffbfefff, 0xffffffdfffefffff, 0xfffffeffffffffff,
    0xbfffffffffffffff, 0xc0598bcffdfddfd7, 0x8007ffffff007ff2, 0x072e6061b3dc3000, 0xb9f3022447f7cfff, 0xf3ffff257fffd1e7,
    0x047fffff7951ef2f, 0xa9f5540000002018, 0x3d05187112ef9db8, 0xc58d105014077fff, 0x0000204100040005, 0xffefefdb77b800a2,
    0xfffeffffffffffff, 0xfffffffffff7ffff, 0xfdffffff7fffffff, 0xfefffffff7fffff7, 0xffffffffbffffbdf, 0xff7fffff7fffd7fd,
    0xfffffeffffbfffff, 0x7efbfffdf7ffffff, 0xffffffffffffffff, 0xfffffff7ffffffef, 0xfffff7ffdfffcfff, 0x27ff77ffffeffbe9,
    0xfd7ffffffff04820, 0xfe79ee2fff7ffffe, 0xfffffcdfd56fff7f, 0xf7dfffdffeffffff, 0xf5dd097c40651a70, 0xf5b5d63fffdffa6a,
    0x1570014203ffffff, 0xfffffe24df565825, 0x400220005c50542d, 0x6010041050810697, 0x5605100000000000, 0x0200106000001040,
    0x66b67fdf19201180, 0xb9d4dfbed5706950, 0x0421500406204837, 0xe105ff9835400000, 0x0003113f7df46c98, 0x0000000900000002,
    0x000400100100a000, 0xfffcfbe7dbffddff, 0xa5dffb061841442b, 0x727142d490002047, 0x200003fefbff1edf, 0xbfdffbbfc1ee0c70,
    0xdf5fcfffff7fdf7f, 0xfc40101107ff447e, 0xf86055ff9ddf7ff7, 0x30000003dbd77f5e, 0x3010000400042714, 0x0000000000800194,
    0x0000000000000000, 0x0000000000000000, 0x0000000000000000, 0x0000000000000000, 0x0000000000000000, 0x0000000000000000,
    0x0000000000000000, 0x7bdef00000000000, 0x140c1095d13ee57e, 0x0000000800117fa2, 0x0002300bffffef00, 0x3b53000000800002,
    0x016241100000010e, 0x05001a3831002010, 0x0000000481183010, 0x87f10aa127fffdff, 0x000000020800052d, 0x2100019020210400,
    0x00000319c5f61104, 0x001000020025c010, 0xfdfbf00002001420, 0xdcfdedf3ffffffff, 0x0404b7fffffafffb, 0xbfffff7fdeffdf11,
    0xf7ff17bf16fffdff, 0xbffbfeff7eeff7ff, 0xf57bf7efdffdfffd, 0xffdf7dc9f76816ff, 0xf575ffffefbfffff, 0xffffe6218505fef5,
    0x17dc67d0f159f159, 0xfffffff7ef7f592a, 0xff6fdffffddfdfff, 0xfe3ff0298403fff5, 0x07fdfffdffef6f3f, 0xfffbeffbc7b153ed,
    0xeffff7ff7fffff7f, 0xf802feffdd7f7dbf, 0xfff9fffffffffc5b, 0xf067fdfbffdfffff, 0x67dcf5ddbf8ff771, 0x000201ea07beab91,
    0x0000004482404023, 0x4000400000406d44, 0x0080050060130000, 0xc100004002400000, 0x6f14f140f4dd758d, 0x00000400a4ad5641,
    0xbffdc00000008004, 0x004a0244148581fe, 0x0001000224012300, 0x0000001000000000, 0x100936fbf1010800, 0x0000000000000000,
    0x000000000002d80c, 0x2c286c00000000a0, 0x00218ff010000000, 0x025003f79fff0120, 0x0000000000a00000, 0x0090003100040000,
    0x0008300000100002, 0x0000000000100000, 0xf000000000000000, 0x01011be7ecffffff, 0x05ef1cd440192000, 0x1105504143000010,
    0x00004057a3ff6040, 0x1df7d9775552080b, 0x46757f543d578cc7, 0x72c0000000000011, 0x005680360541fdbf, 0x030000001ba388b1,
    0x2110310000044240, 0x7d7fff5f00000010, 0x150157a78d670bcd, 0xb00000041e984a40, 0xa9030e8007452396, 0xfffefff020000926,
    0xdf2ffffeff453857, 0xffffffc42f54cc7d, 0xb9f16cc56c080001, 0x1afa4bdffef7d37f, 0x0084a4e5d0118440, 0x024201080e030285,
    0x80601fe6fffffff0, 0xe2b15010116400a8, 0x2456990100000013, 0x00003bfbfe101020, 0xf449e54d1a7d4100, 0x3d42055b3668ffdd,
    0xc000000803d30d8c, 0x200506f84c511f44, 0x0200007dbbf7f502, 0x00044061045b2841, 0xffdfff0001102120, 0x8000000811602057,
    0x0000000020c10000, 0x0330084280230830, 0xae4cb0000002423c, 0x67ffffff114c8463, 0xffffc07508401011, 0x10138104000010ff,
    0x3081676e140121c0, 0x0000001000000100, 0x080400a242200000, 0x0000000000000000,
];

/// The same for the regions of two letters.
static REGIONS: [u64; 11] = [
    0xdeddfdefeedf797d, 0x1e00d58015963f6f, 0x0015fb9fb2095c02, 0x0340400f781c068d, 0xfd4f8141f42b1d00, 0x0100086b25d7fffc,
    0x40000001538f3c40, 0xbfbb7be7fdf15100, 0x004085570430419a, 0x0018000000004002, 0x0000000908400418,
];

/// Three digits each.
static NUMERIC_REGIONS: &str = "\
    001002003005009011013014015017018019021029030034035039053054057061142143145150151154155202419";

/// Four letters each.
static SCRIPTS: &str = "\
    adlmafakaghbahomarabaranarmiarmnavstbalibamubassbatkbengbhksblisbopobrahbraibugibuhdcakmcanscarichamcherchrscirt\
    coptcpmncprtcyrlcyrsdevadiakdogrdsrtduplegydegyhegypelbaelymethigeokgeorglaggonggonmgothgrangrekgujrguruhanbhang\
    hanihanohanshanthatrhebrhirahluwhmnghmnphrkthungindsitaljamojavajpanjurckalikanakharkhmrkhojkitlkitskndakorekpel\
    kthilanalaoolatflatglatnlekelepclimblinalinblisulomalycilydimahjmakamandmanimarcmayamedfmendmercmeromlymmodimong\
    moonmroomteimultmymrnandnarbnbatnewankdbnkgbnkoonshuogamolckorkhoryaosgeosmaougrpalmpaucpcunpelmpermphagphliphlp\
    phlvphnxpiqdplrdprtipsinranjrjngrohgrororunrsamrsarasarbsaursgnwshawshrdshuisiddsindsinhsogdsogosorasoyosundsylo\
    syrcsyresyrjsyrntagbtakrtaletalutamltangtavttelutengtfngtglgthaathaitibttirhtnsatotougarvaiivispvithwarawchowole\
    xpeoxsuxyeziyiiizanbzinhzmthzsyezsymzxxxzyyyzzzz";

/// The language that an extended language follows, and after a colon those that follow it, three letters each.
static EXTENDED_LANGUAGES: &str = "\
    ar:aaoabhabvacmacqacwacxacyadfaebaecafbajpapcapdarbarqarsaryarzauzavlayhaylaynaypbbzpgashussh kok:gomknn lv:ltgl\
    vs ms:bjnbtjbvebvucoaduphjijakjaxkvbkvrkxdlcelcfliwmaxmeomfamfbminmqgmsimuiornorspelpsetmwurkvkkvktxmmzlmzmizsm \
    sgn:adsaedaenafgaseasfaspasqaswbfibfkbogbqnbqybvlbzscdscsccsdcsecsfcsgcslcsncsqcsrcsxdoqdsedslecsehseslesnesoeth\
    fcsfsefslfssgdsgsegsggsmgssgushabhafhdshkshoshpshshhslicliksilsinlinsiseisgisrjcsjhsjksjlsjosjsljuskgikvklbsllsl\
    sblsglsllsnlsolsplstlsvlsylwsmdlmfsmremsdmsrmzcmzgmzynbsncsnsinslnspnsrnzsoklpgzpksprlprzpscpsdpsgpslpsopsppsrpy\
    srmsrsirslrsmsdlsfbsfssggsgxslfslssqksqssqxsspssrsvkswlsyyszstsetsmtsqtsstsytzaugnugyukluksvgtvsivslvsvwbsxkixml\
    xmsydsygsyhsyslysmzibzsl sw:swcswh uz:uznuzs zh:cdocjycmncnpcpxcspczhczoganhakhsnlzhmnpnanwuuyue";

/// Each variant, and after a colon what a tag with it has to start with: one of these.
static VARIANTS: &str = "\
    1606nict:frm 1694acad:fr 1901:de 1959acad:be 1994:sl-rozaj 1996:de abl1943:pt-br akuapem:tw alalc97 aluku:djk \
    ao1990:pt,gl aranes:oc arevela:hy arevmda:hy arkaika:eo asante:tw auvern:oc \
    baku1926:az,ba,crh,kk,krc,ky,sah,tk,tt,uz balanka:blo barla:kea basiceng:en bauddha:sa biscayan:eu \
    biske:sl-rozaj bohoric:sl boont:en bornholm:da cisaup:oc colb1945:pt cornu:en creiss:oc dajnko:sl ekavsk:sr \
    emodeng:en fonipa fonkirsh fonnapa fonupa fonxsamp gascon:oc grclass:oc grital:oc grmistr:oc hepburn:ja-latn \
    heploc:ja-latn-hepburn hognorsk:nn hsistemo:eo ijekavsk:sr itihasa:sa ivanchov:bg jauer:rm jyutping:yue \
    kkcor:kw kociewie:pl kscor:kw laukika:sa lemosin:oc lengadoc:oc lipaw:sl-rozaj luna1918:ru metelko:sl \
    monoton:el ndyuka:djk nedis:sl newfound:en-ca nicard:oc njiva:sl-rozaj nulik:vo osojs:sl-rozaj oxendict:en \
    pahawh2:mww,hnj pahawh3:mww,hnj pahawh4:mww,hnj pamaka:djk peano:la petr1708:ru pinyin:zh-latn,bo-latn \
    polyton:el provenc:oc puter:rm rigik:vo rozaj:sl rumgr:rm scotland:en scouse:en simple solba:sl-rozaj sotav:kea \
    spanglis:en,es surmiran:rm sursilv:rm sutsilv:rm tarask:be tongyong:zh-latn tunumiit:kl uccor:kw ucrcor:kw \
    ulster:sco unifon:en,hup,kyh,tol,yur vaidika:sa valencia:ca vallader:rm vecdruka:lv vivaraup:oc \
    wadegile:zh-latn xsistemo:eo";

static GRANDFATHERED: &str = "\
    art-lojban cel-gaulish en-gb-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn \
    i-tao i-tay i-tsu no-bok no-nyn sgn-be-fr sgn-be-nl sgn-ch-de zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang";
