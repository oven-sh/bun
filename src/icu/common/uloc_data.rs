//! The tables of ICU4C: uloc.cpp, locid.cpp, loclikely.cpp

/// The three-letter ISO 639 codes that have a two-letter code. Sorted.
#[rustfmt::skip]
pub(crate) static LANGUAGES: &[[u8; 7]] = concat!(
    "aar=aa abk=ab afr=af aka=ak amh=am ara=ar arg=an asm=as ava=av ave=ae aym=ay aze=az bak=ba bam=bm bel=be ben=bn bis=bi ",
    "bod=bo bos=bs bre=br bul=bg cat=ca ces=cs cha=ch che=ce chu=cu chv=cv cor=kw cos=co cre=cr cym=cy dan=da deu=de div=dv ",
    "dzo=dz ell=el eng=en epo=eo est=et eus=eu ewe=ee fao=fo fas=fa fij=fj fin=fi fra=fr fry=fy ful=ff gla=gd gle=ga glg=gl ",
    "glv=gv grn=gn guj=gu hat=ht hau=ha heb=he her=hz hin=hi hmo=ho hrv=hr hun=hu hye=hy ibo=ig ido=io iii=ii iku=iu ile=ie ",
    "ina=ia ind=id ipk=ik isl=is ita=it jav=jv jaw=jw jpn=ja kal=kl kan=kn kas=ks kat=ka kau=kr kaz=kk khm=km kik=ki kin=rw ",
    "kir=ky kom=kv kon=kg kor=ko kua=kj kur=ku lao=lo lat=la lav=lv lim=li lin=ln lit=lt ltz=lb lub=lu lug=lg mah=mh mal=ml ",
    "mar=mr mkd=mk mlg=mg mlt=mt mol=mo mon=mn mri=mi msa=ms mya=my nau=na nav=nv nbl=nr nde=nd ndo=ng nep=ne nld=nl nno=nn ",
    "nob=nb nor=no nya=ny oci=oc oji=oj ori=or orm=om oss=os pan=pa pli=pi pol=pl por=pt pus=ps que=qu roh=rm ron=ro run=rn ",
    "rus=ru sag=sg san=sa sin=si slk=sk slv=sl sme=se smo=sm sna=sn snd=sd som=so sot=st spa=es sqi=sq srd=sc srp=sr ssw=ss ",
    "sun=su swa=sw swe=sv tah=ty tam=ta tat=tt tel=te tgk=tg tgl=tl tha=th tir=ti ton=to tsn=tn tso=ts tuk=tk tur=tr twi=tw ",
    "uig=ug ukr=uk urd=ur uzb=uz ven=ve vie=vi vol=vo wln=wa wol=wo xho=xh yid=yi yor=yo zha=za zho=zh zul=zu ",
).as_bytes().as_chunks().0;

/// The three-letter ISO 3166 codes with their two-letter codes. Sorted.
#[rustfmt::skip]
pub(crate) static COUNTRIES: &[[u8; 7]] = concat!(
    "ABW=AW AFG=AF AGO=AO AIA=AI ALA=AX ALB=AL AND=AD ANT=AN ARE=AE ARG=AR ARM=AM ASM=AS ATA=AQ ATF=TF ATG=AG AUS=AU AUT=AT ",
    "AZE=AZ BDI=BI BEL=BE BEN=BJ BES=BQ BFA=BF BGD=BD BGR=BG BHR=BH BHS=BS BIH=BA BLM=BL BLR=BY BLZ=BZ BMU=BM BOL=BO BRA=BR ",
    "BRB=BB BRN=BN BTN=BT BUR=BU BVT=BV BWA=BW CAF=CF CAN=CA CCK=CC CHE=CH CHL=CL CHN=CN CIV=CI CMR=CM COD=CD COG=CG COK=CK ",
    "COL=CO COM=KM CPV=CV CRI=CR CRQ=CQ CUB=CU CUW=CW CXR=CX CYM=KY CYP=CY CZE=CZ DEU=DE DGA=DG DJI=DJ DMA=DM DNK=DK DOM=DO ",
    "DZA=DZ ECU=EC EGY=EG ERI=ER ESH=EH ESP=ES EST=EE ETH=ET FIN=FI FJI=FJ FLK=FK FRA=FR FRO=FO FSM=FM FXX=FX GAB=GA GBR=GB ",
    "GEO=GE GGY=GG GHA=GH GIB=GI GIN=GN GLP=GP GMB=GM GNB=GW GNQ=GQ GRC=GR GRD=GD GRL=GL GTM=GT GUF=GF GUM=GU GUY=GY HKG=HK ",
    "HMD=HM HND=HN HRV=HR HTI=HT HUN=HU IDN=ID IMN=IM IND=IN IOT=IO IRL=IE IRN=IR IRQ=IQ ISL=IS ISR=IL ITA=IT JAM=JM JEY=JE ",
    "JOR=JO JPN=JP KAZ=KZ KEN=KE KGZ=KG KHM=KH KIR=KI KNA=KN KOR=KR KWT=KW LAO=LA LBN=LB LBR=LR LBY=LY LCA=LC LIE=LI LKA=LK ",
    "LSO=LS LTU=LT LUX=LU LVA=LV MAC=MO MAF=MF MAR=MA MCO=MC MDA=MD MDG=MG MDV=MV MEX=MX MHL=MH MKD=MK MLI=ML MLT=MT MMR=MM ",
    "MNE=ME MNG=MN MNP=MP MOZ=MZ MRT=MR MSR=MS MTQ=MQ MUS=MU MWI=MW MYS=MY MYT=YT NAM=NA NCL=NC NER=NE NFK=NF NGA=NG NIC=NI ",
    "NIU=NU NLD=NL NOR=NO NPL=NP NRU=NR NZL=NZ OMN=OM PAK=PK PAN=PA PCN=PN PER=PE PHL=PH PLW=PW PNG=PG POL=PL PRI=PR PRK=KP ",
    "PRT=PT PRY=PY PSE=PS PYF=PF QAT=QA REU=RE ROM=RO ROU=RO RUS=RU RWA=RW SAU=SA SCG=CS SDN=SD SEN=SN SGP=SG SGS=GS SHN=SH ",
    "SJM=SJ SLB=SB SLE=SL SLV=SV SMR=SM SOM=SO SPM=PM SRB=RS SSD=SS STP=ST SUN=SU SUR=SR SVK=SK SVN=SI SWE=SE SWZ=SZ SXM=SX ",
    "SYC=SC SYR=SY TCA=TC TCD=TD TGO=TG THA=TH TJK=TJ TKL=TK TKM=TM TLS=TL TMP=TP TON=TO TTO=TT TUN=TN TUR=TR TUV=TV TWN=TW ",
    "TZA=TZ UGA=UG UKR=UA UMI=UM URY=UY USA=US UZB=UZ VAT=VA VCT=VC VEN=VE VGB=VG VIR=VI VNM=VN VUT=VU WLF=WF WSM=WS XEA=EA ",
    "XIC=IC XKK=XK YEM=YE YMD=YD YUG=YU ZAF=ZA ZAR=ZR ZMB=ZM ZWE=ZW ",
).as_bytes().as_chunks().0;

/// Deprecated codes with their replacements. Sorted.
#[rustfmt::skip]
pub(crate) static DEPRECATED_COUNTRIES: &[[u8; 6]] =
    b"AN=CW BU=MM CS=RS DD=DE DY=BJ FX=FR HV=BF NH=VU RH=ZW SU=RU TP=TL UK=GB VD=VN YD=YE YU=RS ZR=CD ".as_chunks().0;

#[rustfmt::skip]
pub(crate) const CANONICALIZE_MAP: &[(&[u8], &[u8])] = &[
    (b"art__LOJBAN", b"jbo"), (b"hy__AREVELA", b"hy"), (b"hy__AREVMDA", b"hyw"), (b"zh__GUOYU", b"zh"),
    (b"zh__HAKKA", b"hak"), (b"zh__XIANG", b"hsn"), (b"zh_GAN", b"gan"), (b"zh_MIN_NAN", b"nan"), (b"zh_WUU", b"wuu"),
    (b"zh_YUE", b"yue"),
];

/// Sorted languages without a replacement, for which the aliases stay unread.
#[rustfmt::skip]
pub(crate) const KNOWN_LANGUAGES: [&[u8]; 83] = [
    b"af", b"am", b"ar", b"as", b"az", b"be", b"bg", b"bn", b"bs", b"ca", b"cs", b"cy", b"da", b"de", b"el", b"en", b"es",
    b"et", b"eu", b"fa", b"fi", b"fil", b"fr", b"ga", b"gl", b"gu", b"he", b"hi", b"hr", b"hu", b"hy", b"id", b"is", b"it",
    b"ja", b"jv", b"ka", b"kk", b"km", b"kn", b"ko", b"ky", b"lo", b"lt", b"lv", b"mk", b"ml", b"mn", b"mr", b"ms", b"my",
    b"nb", b"ne", b"nl", b"no", b"or", b"pa", b"pl", b"ps", b"pt", b"ro", b"ru", b"sd", b"si", b"sk", b"sl", b"so", b"sq",
    b"sr", b"sv", b"sw", b"ta", b"te", b"th", b"tk", b"tr", b"uk", b"ur", b"uz", b"vi", b"yue", b"zh", b"zu",
];

/// A bit set of the valid two-letter regions, indexed by `first * 26 + second`.
#[rustfmt::skip]
pub(crate) const VALID_REGION_MAP: [u32; 22] = [
    0xeedf597c, 0xdeddbdef, 0x15943f3f, 0x0e00d580, 0xb0095c00, 0x0015fb9f, 0x781c068d, 0x0340400f, 0xf42b1d00,
    0xfd4f8141, 0x25d7fffc, 0x0100084b, 0x538f3c40, 0x40000001, 0xfdf15100, 0x9fbb7ae7, 0x0410419a, 0x00408557,
    0x00004002, 0x00100001, 0x00400408, 0x00000001,
];
