//! The tables of ICU4C: uloc_tag.cpp

/// Legacy and redundant tags with their preferred values. Sorted by length.
#[rustfmt::skip]
pub(crate) const PREFERRED: &[(&[u8], &[u8])] = &[
    (b"i-ami", b"ami"), (b"i-bnn", b"bnn"), (b"i-hak", b"hak"), (b"i-lux", b"lb"), (b"i-pwn", b"pwn"), (b"i-tao", b"tao"),
    (b"i-tay", b"tay"), (b"i-tsu", b"tsu"), (b"no-bok", b"nb"), (b"no-nyn", b"nn"), (b"sgn-br", b"bzs"),
    (b"sgn-co", b"csn"), (b"sgn-de", b"gsg"), (b"sgn-dk", b"dsl"), (b"sgn-es", b"ssp"), (b"sgn-fr", b"fsl"),
    (b"sgn-gb", b"bfi"), (b"sgn-gr", b"gss"), (b"sgn-ie", b"isg"), (b"sgn-it", b"ise"), (b"sgn-jp", b"jsl"),
    (b"sgn-mx", b"mfs"), (b"sgn-ni", b"ncs"), (b"sgn-nl", b"dse"), (b"sgn-no", b"nsl"), (b"sgn-pt", b"psr"),
    (b"sgn-se", b"swl"), (b"sgn-us", b"ase"), (b"sgn-za", b"sfs"), (b"zh-cmn", b"cmn"), (b"zh-gan", b"gan"),
    (b"zh-min", b"nan-x-zh-min"), (b"zh-wuu", b"wuu"), (b"zh-yue", b"yue"), (b"i-mingo", b"see-x-i-mingo"),
    (b"i-navajo", b"nv"), (b"zh-guoyu", b"cmn"), (b"zh-hakka", b"hak"), (b"zh-xiang", b"hsn"),
    (b"en-gb-oed", b"en-gb-oxendict"), (b"i-default", b"en-x-i-default"), (b"i-klingon", b"tlh"), (b"sgn-be-fr", b"sfb"),
    (b"sgn-be-nl", b"vgt"), (b"sgn-ch-de", b"sgg"), (b"art-lojban", b"jbo"), (b"i-enochian", b"und-x-i-enochian"),
    (b"zh-min-nan", b"nan"), (b"ja-latn-hepburn-heploc", b"ja-latn-alalc97"),
];

/// Sorted.
#[rustfmt::skip]
pub(crate) static DEPRECATEDLANGS: &[[u8; 8]] = concat!(
    "aam=aas adp=dz  aue=ktz ayx=nun bgm=bcg bjd=drl ccq=rki cjr=mom cka=cmr cmk=xch coy=pij cqu=quh drh=khk drw=prs gav=dev ",
    "gfx=vaj ggn=gvr gti=nyc guv=duz hrr=jal ibi=opa ilw=gal in =id  iw =he  jeg=oyb ji =yi  jw =jv  kgc=tdf kgh=kml koj=kwv ",
    "krm=bmf ktr=dtp kvs=gdj kwq=yam kxe=tvd kzj=dtp kzt=dtp lii=raq lmm=rmx meg=cir mo =ro  mst=mry mwj=vaj myt=mry nad=xny ",
    "ncp=kdz nnx=ngv nts=pij oun=vaj pcr=adx pmc=huw pmu=phr ppa=bfy ppr=lcq pry=prt puz=pub sca=hle skk=oyb tdu=dtp thc=tpo ",
    "thx=oyb tie=ras tkk=twm tlw=weo tmp=tyj tne=kak tnf=prs tsf=taj uok=ema xba=cax xia=acn xkh=waw xsj=suj ybd=rki yma=lrr ",
    "ymt=mtm yos=zom yuu=yug ",
).as_bytes().as_chunks().0;

/// Sorted.
pub(crate) static DEPRECATEDREGIONS: &[[u8; 6]] =
    b"BU=MM DD=DE FX=FR TP=TL YD=YE ZR=CD ".as_chunks().0;
