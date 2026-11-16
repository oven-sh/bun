//! How OpenType names scripts and languages.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use crate::text::sfnt::Tag;
use crate::unicode::Script;

pub fn script_tags(script: Script) -> Vec<Tag> {
    const NEWER: [(&Tag, &[u8; 3]); 10] = [
        (b"Beng", b"bng"),
        (b"Deva", b"dev"),
        (b"Gujr", b"gjr"),
        (b"Guru", b"gur"),
        (b"Knda", b"knd"),
        (b"Mlym", b"mlm"),
        (b"Orya", b"ory"),
        (b"Taml", b"tml"),
        (b"Telu", b"tel"),
        (b"Mymr", b"mym"),
    ];
    let newer = NEWER
        .iter()
        .filter(|it| *it.0 == script.0)
        .flat_map(|&(_, &[a, b, c])| [[a, b, c, b'3'], [a, b, c, b'2']]);
    let old = match &script.0 {
        b"Hira" => *b"kana",
        b"Laoo" => *b"lao ",
        b"Yiii" => *b"yi  ",
        b"Nkoo" => *b"nko ",
        b"Vaii" => *b"vai ",
        b"Zmth" => *b"math",
        &[a, b, c, d] => [a | 0x20, b, c, d],
    };
    newer.filter(|it| it != b"mym3").chain([old]).collect()
}

/// Languages of three letters that are not listed have the same letters.
const LANGUAGES: &str = "aa AFR,ab ABK,af AFK,ak AKA,am AMH,an ARG,ar ARA,as ASM,av AVR,ay AYM,az AZE,ba BSH,be BEL,bg BGR,bi BIS,\
    bm BMB,bn BEN,bo TIB,br BRE,bs BOS,ca CAT,ce CHE,ch CHA,co COS,cr CRE,cs CSY,cu CSL,cv CHU,cy WEL,da DAN,de DEU,dv DIV DHV,dz DZN,\
    ee EWE,el ELL,en ENG,eo NTO,es ESP,et ETI,eu EUQ,fa FAR,ff FUL,fi FIN,fj FJI,fo FOS,fr FRA,fy FRI,ga IRI,gd GAE,gl GAL,gn GUA,gu GUJ,\
    gv MNX,ha HAU,he IWR,hi HIN,ho HMO CPP,hr HRV,ht HAI CPP,hu HUN,hy HYE0 HYE,hz HER,ia INA,id IND MLY,ie ILE,ig IBO,ii YIM,ik IPK,\
    in IND MLY,io IDO,is ISL,it ITA,iu INU INUK,iw IWR,ja JAN,ji JII,jv JAV,ka KAT,kg KON0,ki KIK,kj KUA,kk KAZ,kl GRN,km KHM,kn KAN,\
    ko KOR KOH,kr KNR,ks KSH,ku KUR,kv KOM,kw COR,ky KIR,la LAT,lb LTZ,lg LUG,li LIM,ln LIN,lo LAO,lt LTH,lu LUB,lv LVI,mg MLG,mh MAH,\
    mi MRI,mk MKD,ml MAL MLR,mn MNG,mo MOL ROM,mr MAR,ms MLY,mt MTS,my BRM,na NAU,nb NOR,nd NDB,ne NEP,ng NDG,nl NLD,nn NYN,no NOR,\
    nr NDB,nv NAV ATH,ny CHI,oc OCI,oj OJB,om ORO,or ORI,os OSS,pa PAN,pi PAL,pl PLK,ps PAS,pt PTG,qu QUZ,rm RMS,rn RUN,ro ROM,ru RUS,\
    rw RUA,sa SAN,sc SRD,sd SND,se NSM,sg SGO,sh BOS HRV SRB,si SNH,sk SKY,sl SLV,sm SMO,sn SNA0,so SML,sq SQI,sr SRB,ss SWZ,st SOT,\
    su SUN,sv SVE,sw SWK,ta TAM,te TEL,tg TAJ,th THA,ti TGY,tk TKM,tl TGL,tn TNA,to TGN,tr TRK,ts TSG,tt TAT,tw TWI AKA,ty THT,ug UYG,\
    uk UKR,ur URD,uz UZB,ve VEN,vi VIT,vo VOL,wa WLN,wo WLF,xh XHS,yi JII,yo YBA,za ZHA,zu ZUL,ber BBR,bho BHO,cak CAK MYN,ckb KUR,\
    crh CRT,doi DGR,dsb LSB,fil PIL,gez GEZ,grc PGR,gsw ALS,haw HAW,hsb USB,kab KAB0 BBR,kbd KAB,kok KOK,krc KAR BAL,ksw KSW KRN,\
    mai MTH,mnw MON MONT,nso NSO,prs DRI FAR,sah YAK,sat SAT,sma SSM,smj LSM,smn ISM,sms SKS,syr SYR,tcy TUL,tzm TZM BBR,xal KLM TOD,\
    zgh ZGH BBR";

pub fn language_tags(language: &[u8]) -> Vec<Tag> {
    let language = String::from_utf8_lossy(language)
        .to_ascii_lowercase()
        .replace('_', "-");
    if let Some(tag) = language
        .strip_prefix("x-hbot-")
        .and_then(|it| u32::from_str_radix(it, 16).ok())
    {
        return vec![tag.to_be_bytes()];
    }
    let (primary, has) = (language.split('-').next().unwrap_or(""), |part: &str| {
        language.split('-').skip(1).any(|it| it == part)
    });
    let tags = match primary {
        _ if has("fonipa") => "IPPH",
        _ if has("fonnapa") => "APPH",
        "zh" | "cmn" | "yue" | "lzh" if has("hans") => "ZHS",
        "zh" | "cmn" if has("mo") => "ZHTM ZHH",
        "zh" | "cmn" if has("hk") => "ZHH",
        "zh" | "cmn" if has("hant") || has("tw") => "ZHT",
        "zh" | "cmn" => "ZHS",
        "yue" => "ZHH",
        "lzh" => "ZHT",
        "el" if has("polyton") => "PGR",
        "ga" if has("latg") => "IRT IRI",
        "ro" if has("md") => "MOL ROM",
        "nl" if has("be") => "FLE NLD",
        _ => {
            let listed = LANGUAGES
                .split(',')
                .find_map(|it| it.trim_start().strip_prefix(primary)?.strip_prefix(' '));
            listed.unwrap_or(if primary.len() == 3 { primary } else { "" })
        }
    };
    let tag = |it: &str| {
        std::array::from_fn(|at| it.as_bytes().get(at).map_or(b' ', u8::to_ascii_uppercase))
    };
    tags.split_whitespace().map(tag).collect()
}
