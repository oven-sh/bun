//! The tables of ICU4C: propname_data.h

use crate::common::slice_ext::to_index;
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

/// The other names of four letters, each with the short name.
const SCRIPT_ALIASES: [(&[u8], &[u8]); 3] =
    [(b"Qaai", b"Zinh"), (b"Qaac", b"Copt"), (b"Miao", b"Plrd")];

/// Returns an empty name for an unknown code.
pub(crate) fn uscript_get_short_name(script: UScriptCode) -> &'static [u8] {
    SCRIPT_NAMES.get(to_index(script)).map_or(&[], |name| name)
}

/// Knows the names of four letters only. Ignores case.
pub(crate) fn uscript_get_code(name: &[u8]) -> Option<UScriptCode> {
    let name = SCRIPT_ALIASES
        .iter()
        .find(|(alias, _)| name.eq_ignore_ascii_case(alias))
        .map_or(name, |&(_, short_name)| short_name);
    SCRIPT_NAMES
        .iter()
        .position(|short_name| name.eq_ignore_ascii_case(short_name))
        .map(|index| index as UScriptCode)
}
