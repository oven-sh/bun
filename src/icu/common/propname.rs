//! The names of properties and of their values. ICU4C: propname.cpp, propname.h

use crate::common::bytes::I32s;
use crate::common::bytestrie::BytesTrie;
use crate::common::cstring::until_nul;
use crate::common::slice_ext::to_index;
use crate::common::udata::{compiled_in, compiled_in_index};
use crate::common::unicode::uchar::UProperty;
use crate::common::unicode::uscript::UScriptCode;

/// The short name of each script, in the order of `UScriptCode`.
const SCRIPT_NAMES: &[[u8; 4]] = b"\
    ZyyyZinhArabArmnBengBopoCherCoptCyrlDsrtDevaEthiGeorGothGrekGujrGuruHaniHangHebrHiraKndaKanaKhmrLaoo\
    LatnMlymMongMymrOgamItalOryaRunrSinhSyrcTamlTeluThaaThaiTibtCansYiiiTglgHanoBuhdTagbBraiCprtLimbLinb\
    OsmaShawTaleUgarHrktBugiGlagKharSyloTaluTfngXpeoBaliBatkBlisBrahChamCirtCyrsEgydEgyhEgypGeokHansHant\
    HmngHungIndsJavaKaliLatfLatgLepcLinaMandMayaMeroNkooOrkhPermPhagPhnxPlrdRoroSaraSyreSyrjSyrnTengVaii\
    VispXsuxZxxxZzzzCariJpanLanaLyciLydiOlckRjngSaurSgnwSundMoonMteiArmiAvstCakmKoreKthiManiPhliPhlpPhlv\
    PrtiSamrTavtZmthZsymBamuLisuNkgbSarbBassDuplElbaGranKpelLomaMendMercNarbNbatPalmSindWaraAfakJurcMroo\
    NshuShrdSoraTakrTangWoleHluwKhojTirhAghbMahjAhomHatrModiMultPaucSiddAdlmBhksMarcNewaOsgeHanbJamoZsye\
    GonmSoyoZanbDogrGongMakaMedfRohgSogdSogoElymHmnpNandWchoChrsDiakKitsYeziCpmnOugrTnsaTotoVithKawiNagm\
    AranGaraGukhKraiOnaoSunuTodrTutgBerfSidtTayoTolsHntlPcunSeal"
    .as_chunks()
    .0;

/// The other names of at most four letters, each with the short name.
const SCRIPT_ALIASES: [(&[u8], &[u8]); 9] = [
    (b"qaai", b"Zinh"),
    (b"qaac", b"Copt"),
    (b"miao", b"Plrd"),
    (b"han", b"Hani"),
    (b"lao", b"Laoo"),
    (b"mro", b"Mroo"),
    (b"nko", b"Nkoo"),
    (b"vai", b"Vaii"),
    (b"yi", b"Yiii"),
];

/// Returns an empty name for an unknown code.
pub(crate) fn uscript_get_short_name(script: UScriptCode) -> &'static [u8] {
    SCRIPT_NAMES.get(to_index(script)).map_or(&[], |name| name)
}

/// Knows the names of at most four letters. Does not use `PNAMES`, so that `--trim` can remove that.
pub(crate) fn uscript_get_code(name: &[u8]) -> Option<UScriptCode> {
    let name = SCRIPT_ALIASES
        .iter()
        .find(|(alias, _)| property_names_match(alias, name))
        .map_or(name, |&(_, short_name)| short_name);
    SCRIPT_NAMES
        .iter()
        .position(|short_name| name.eq_ignore_ascii_case(short_name))
        .map(|index| index as UScriptCode)
}

const IX_VALUE_MAPS_OFFSET: usize = 0;
const IX_BYTE_TRIES_OFFSET: usize = 1;

const PNAMES: &[u8] = compiled_in!("pnames.icu", b"pnam", 2).1;

macro_rules! section {
    ($index:ident) => {
        PNAMES
            .split_at(compiled_in_index!(PNAMES, $index + 1))
            .0
            .split_at(compiled_in_index!(PNAMES, $index))
            .1
    };
}

const VALUE_MAPS: I32s = I32s::of(section!(IX_VALUE_MAPS_OFFSET));
const BYTES_TRIES: &[u8] = section!(IX_BYTE_TRIES_OFFSET);

/// Returns the characters up to the first NUL that loose matching compares (UAX44-LM3), in lowercase.
fn significant_chars(name: &[u8]) -> impl Iterator<Item = u8> {
    until_nul(name)
        .iter()
        .filter(|c| !matches!(c, b'-' | b'_' | b' ' | 0x09..=0x0d))
        .map(u8::to_ascii_lowercase)
}

/// `expected` is in lowercase and has no delimiters.
pub(crate) fn property_names_match(expected: &[u8], name: &[u8]) -> bool {
    significant_chars(name).eq(expected.iter().copied())
}

/// Returns the index of the value map, whose first word is the offset of its trie, or `None` if the values have no names.
fn find_value_map(property: UProperty) -> Option<usize> {
    // A range has its start, its limit, and for each property the offset of its names and the index of its value map.
    let mut index = 1;
    for _ in 0..VALUE_MAPS.at(0) {
        let (start, limit) = (VALUE_MAPS.at(index), VALUE_MAPS.at(index + 1));
        index += 2;
        if (start..limit).contains(&property) {
            let value_map = VALUE_MAPS.at(index + to_index(property - start) * 2 + 1);
            return (value_map != 0).then_some(to_index(value_map));
        }
        index += to_index(limit - start) * 2;
    }
    None
}

fn find_name(bytes_trie_offset: usize, name: &[u8]) -> Option<i32> {
    let mut trie = BytesTrie::with_root(BYTES_TRIES, bytes_trie_offset);
    let last = significant_chars(name).map(|c| trie.next(c.into())).last();
    last?.has_value().then(|| trie.get_value())
}

pub(crate) fn u_get_property_enum(alias: &[u8]) -> Option<UProperty> {
    find_name(0, alias)
}

pub(crate) fn u_get_property_value_enum(property: UProperty, alias: &[u8]) -> Option<i32> {
    find_name(to_index(VALUE_MAPS.at(find_value_map(property)?)), alias)
}
