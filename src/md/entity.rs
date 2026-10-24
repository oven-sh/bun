//! HTML named entity lookup.

/// Look up an HTML entity by name (including `&` prefix and `;` suffix).
/// Binary search over the sorted, concatenated names.
pub(crate) fn lookup(name: &[u8]) -> Option<[u32; 2]> {
    // Every stored name omits the shared leading `&`.
    let name = name.strip_prefix(b"&")?;
    let mut low: usize = 0;
    let mut high: usize = NAME_OFFSETS.len() - 1;
    while low < high {
        let mid = low + (high - low) / 2;
        match entity_name(mid).cmp(name) {
            core::cmp::Ordering::Less => low = mid + 1,
            core::cmp::Ordering::Greater => high = mid,
            core::cmp::Ordering::Equal => return Some(codepoints(mid)),
        }
    }
    None
}

fn entity_name(index: usize) -> &'static [u8] {
    &NAMES[NAME_OFFSETS[index] as usize..NAME_OFFSETS[index + 1] as usize]
}

/// Set on a `CODEPOINTS` entry whose entity expands to two codepoints; the
/// second one is in `SECOND_CODEPOINTS`.
const HAS_SECOND: u32 = 1 << 31;

fn codepoints(index: usize) -> [u32; 2] {
    let first = CODEPOINTS[index];
    if first & HAS_SECOND == 0 {
        return [first, 0];
    }
    let second = SECOND_CODEPOINTS
        .binary_search_by_key(&(index as u16), |&(i, _)| i)
        .map(|i| SECOND_CODEPOINTS[i].1)
        .unwrap_or(0);
    [first & !HAS_SECOND, second]
}

/// The 2125 entity names (`&` stripped, `;` kept), sorted and concatenated;
/// `NAME_OFFSETS[i]..NAME_OFFSETS[i + 1]` is name `i`.
#[rustfmt::skip]
static NAMES: &[u8] = b"AElig;AMP;Aacute;Abreve;Acirc;Acy;Afr;Agrave;Alpha;Amacr;And;Aogon;Aopf;ApplyFunction;Aring;Ascr;\
Assign;Atilde;Auml;Backslash;Barv;Barwed;Bcy;Because;Bernoullis;Beta;Bfr;Bopf;Breve;Bscr;Bumpeq;\
CHcy;COPY;Cacute;Cap;CapitalDifferentialD;Cayleys;Ccaron;Ccedil;Ccirc;Cconint;Cdot;Cedilla;\
CenterDot;Cfr;Chi;CircleDot;CircleMinus;CirclePlus;CircleTimes;ClockwiseContourIntegral;\
CloseCurlyDoubleQuote;CloseCurlyQuote;Colon;Colone;Congruent;Conint;ContourIntegral;Copf;Coproduct;\
CounterClockwiseContourIntegral;Cross;Cscr;Cup;CupCap;DD;DDotrahd;DJcy;DScy;DZcy;Dagger;Darr;Dashv;\
Dcaron;Dcy;Del;Delta;Dfr;DiacriticalAcute;DiacriticalDot;DiacriticalDoubleAcute;DiacriticalGrave;\
DiacriticalTilde;Diamond;DifferentialD;Dopf;Dot;DotDot;DotEqual;DoubleContourIntegral;DoubleDot;\
DoubleDownArrow;DoubleLeftArrow;DoubleLeftRightArrow;DoubleLeftTee;DoubleLongLeftArrow;\
DoubleLongLeftRightArrow;DoubleLongRightArrow;DoubleRightArrow;DoubleRightTee;DoubleUpArrow;\
DoubleUpDownArrow;DoubleVerticalBar;DownArrow;DownArrowBar;DownArrowUpArrow;DownBreve;\
DownLeftRightVector;DownLeftTeeVector;DownLeftVector;DownLeftVectorBar;DownRightTeeVector;\
DownRightVector;DownRightVectorBar;DownTee;DownTeeArrow;Downarrow;Dscr;Dstrok;ENG;ETH;Eacute;Ecaron;\
Ecirc;Ecy;Edot;Efr;Egrave;Element;Emacr;EmptySmallSquare;EmptyVerySmallSquare;Eogon;Eopf;Epsilon;\
Equal;EqualTilde;Equilibrium;Escr;Esim;Eta;Euml;Exists;ExponentialE;Fcy;Ffr;FilledSmallSquare;\
FilledVerySmallSquare;Fopf;ForAll;Fouriertrf;Fscr;GJcy;GT;Gamma;Gammad;Gbreve;Gcedil;Gcirc;Gcy;Gdot;\
Gfr;Gg;Gopf;GreaterEqual;GreaterEqualLess;GreaterFullEqual;GreaterGreater;GreaterLess;\
GreaterSlantEqual;GreaterTilde;Gscr;Gt;HARDcy;Hacek;Hat;Hcirc;Hfr;HilbertSpace;Hopf;HorizontalLine;\
Hscr;Hstrok;HumpDownHump;HumpEqual;IEcy;IJlig;IOcy;Iacute;Icirc;Icy;Idot;Ifr;Igrave;Im;Imacr;\
ImaginaryI;Implies;Int;Integral;Intersection;InvisibleComma;InvisibleTimes;Iogon;Iopf;Iota;Iscr;\
Itilde;Iukcy;Iuml;Jcirc;Jcy;Jfr;Jopf;Jscr;Jsercy;Jukcy;KHcy;KJcy;Kappa;Kcedil;Kcy;Kfr;Kopf;Kscr;\
LJcy;LT;Lacute;Lambda;Lang;Laplacetrf;Larr;Lcaron;Lcedil;Lcy;LeftAngleBracket;LeftArrow;\
LeftArrowBar;LeftArrowRightArrow;LeftCeiling;LeftDoubleBracket;LeftDownTeeVector;LeftDownVector;\
LeftDownVectorBar;LeftFloor;LeftRightArrow;LeftRightVector;LeftTee;LeftTeeArrow;LeftTeeVector;\
LeftTriangle;LeftTriangleBar;LeftTriangleEqual;LeftUpDownVector;LeftUpTeeVector;LeftUpVector;\
LeftUpVectorBar;LeftVector;LeftVectorBar;Leftarrow;Leftrightarrow;LessEqualGreater;LessFullEqual;\
LessGreater;LessLess;LessSlantEqual;LessTilde;Lfr;Ll;Lleftarrow;Lmidot;LongLeftArrow;\
LongLeftRightArrow;LongRightArrow;Longleftarrow;Longleftrightarrow;Longrightarrow;Lopf;\
LowerLeftArrow;LowerRightArrow;Lscr;Lsh;Lstrok;Lt;Map;Mcy;MediumSpace;Mellintrf;Mfr;MinusPlus;Mopf;\
Mscr;Mu;NJcy;Nacute;Ncaron;Ncedil;Ncy;NegativeMediumSpace;NegativeThickSpace;NegativeThinSpace;\
NegativeVeryThinSpace;NestedGreaterGreater;NestedLessLess;NewLine;Nfr;NoBreak;NonBreakingSpace;Nopf;\
Not;NotCongruent;NotCupCap;NotDoubleVerticalBar;NotElement;NotEqual;NotEqualTilde;NotExists;\
NotGreater;NotGreaterEqual;NotGreaterFullEqual;NotGreaterGreater;NotGreaterLess;\
NotGreaterSlantEqual;NotGreaterTilde;NotHumpDownHump;NotHumpEqual;NotLeftTriangle;\
NotLeftTriangleBar;NotLeftTriangleEqual;NotLess;NotLessEqual;NotLessGreater;NotLessLess;\
NotLessSlantEqual;NotLessTilde;NotNestedGreaterGreater;NotNestedLessLess;NotPrecedes;\
NotPrecedesEqual;NotPrecedesSlantEqual;NotReverseElement;NotRightTriangle;NotRightTriangleBar;\
NotRightTriangleEqual;NotSquareSubset;NotSquareSubsetEqual;NotSquareSuperset;NotSquareSupersetEqual;\
NotSubset;NotSubsetEqual;NotSucceeds;NotSucceedsEqual;NotSucceedsSlantEqual;NotSucceedsTilde;\
NotSuperset;NotSupersetEqual;NotTilde;NotTildeEqual;NotTildeFullEqual;NotTildeTilde;NotVerticalBar;\
Nscr;Ntilde;Nu;OElig;Oacute;Ocirc;Ocy;Odblac;Ofr;Ograve;Omacr;Omega;Omicron;Oopf;\
OpenCurlyDoubleQuote;OpenCurlyQuote;Or;Oscr;Oslash;Otilde;Otimes;Ouml;OverBar;OverBrace;OverBracket;\
OverParenthesis;PartialD;Pcy;Pfr;Phi;Pi;PlusMinus;Poincareplane;Popf;Pr;Precedes;PrecedesEqual;\
PrecedesSlantEqual;PrecedesTilde;Prime;Product;Proportion;Proportional;Pscr;Psi;QUOT;Qfr;Qopf;Qscr;\
RBarr;REG;Racute;Rang;Rarr;Rarrtl;Rcaron;Rcedil;Rcy;Re;ReverseElement;ReverseEquilibrium;\
ReverseUpEquilibrium;Rfr;Rho;RightAngleBracket;RightArrow;RightArrowBar;RightArrowLeftArrow;\
RightCeiling;RightDoubleBracket;RightDownTeeVector;RightDownVector;RightDownVectorBar;RightFloor;\
RightTee;RightTeeArrow;RightTeeVector;RightTriangle;RightTriangleBar;RightTriangleEqual;\
RightUpDownVector;RightUpTeeVector;RightUpVector;RightUpVectorBar;RightVector;RightVectorBar;\
Rightarrow;Ropf;RoundImplies;Rrightarrow;Rscr;Rsh;RuleDelayed;SHCHcy;SHcy;SOFTcy;Sacute;Sc;Scaron;\
Scedil;Scirc;Scy;Sfr;ShortDownArrow;ShortLeftArrow;ShortRightArrow;ShortUpArrow;Sigma;SmallCircle;\
Sopf;Sqrt;Square;SquareIntersection;SquareSubset;SquareSubsetEqual;SquareSuperset;\
SquareSupersetEqual;SquareUnion;Sscr;Star;Sub;Subset;SubsetEqual;Succeeds;SucceedsEqual;\
SucceedsSlantEqual;SucceedsTilde;SuchThat;Sum;Sup;Superset;SupersetEqual;Supset;THORN;TRADE;TSHcy;\
TScy;Tab;Tau;Tcaron;Tcedil;Tcy;Tfr;Therefore;Theta;ThickSpace;ThinSpace;Tilde;TildeEqual;\
TildeFullEqual;TildeTilde;Topf;TripleDot;Tscr;Tstrok;Uacute;Uarr;Uarrocir;Ubrcy;Ubreve;Ucirc;Ucy;\
Udblac;Ufr;Ugrave;Umacr;UnderBar;UnderBrace;UnderBracket;UnderParenthesis;Union;UnionPlus;Uogon;\
Uopf;UpArrow;UpArrowBar;UpArrowDownArrow;UpDownArrow;UpEquilibrium;UpTee;UpTeeArrow;Uparrow;\
Updownarrow;UpperLeftArrow;UpperRightArrow;Upsi;Upsilon;Uring;Uscr;Utilde;Uuml;VDash;Vbar;Vcy;Vdash;\
Vdashl;Vee;Verbar;Vert;VerticalBar;VerticalLine;VerticalSeparator;VerticalTilde;VeryThinSpace;Vfr;\
Vopf;Vscr;Vvdash;Wcirc;Wedge;Wfr;Wopf;Wscr;Xfr;Xi;Xopf;Xscr;YAcy;YIcy;YUcy;Yacute;Ycirc;Ycy;Yfr;\
Yopf;Yscr;Yuml;ZHcy;Zacute;Zcaron;Zcy;Zdot;ZeroWidthSpace;Zeta;Zfr;Zopf;Zscr;aacute;abreve;ac;acE;\
acd;acirc;acute;acy;aelig;af;afr;agrave;alefsym;aleph;alpha;amacr;amalg;amp;and;andand;andd;\
andslope;andv;ang;ange;angle;angmsd;angmsdaa;angmsdab;angmsdac;angmsdad;angmsdae;angmsdaf;angmsdag;\
angmsdah;angrt;angrtvb;angrtvbd;angsph;angst;angzarr;aogon;aopf;ap;apE;apacir;ape;apid;apos;approx;\
approxeq;aring;ascr;ast;asymp;asympeq;atilde;auml;awconint;awint;bNot;backcong;backepsilon;\
backprime;backsim;backsimeq;barvee;barwed;barwedge;bbrk;bbrktbrk;bcong;bcy;bdquo;becaus;because;\
bemptyv;bepsi;bernou;beta;beth;between;bfr;bigcap;bigcirc;bigcup;bigodot;bigoplus;bigotimes;\
bigsqcup;bigstar;bigtriangledown;bigtriangleup;biguplus;bigvee;bigwedge;bkarow;blacklozenge;\
blacksquare;blacktriangle;blacktriangledown;blacktriangleleft;blacktriangleright;blank;blk12;blk14;\
blk34;block;bne;bnequiv;bnot;bopf;bot;bottom;bowtie;boxDL;boxDR;boxDl;boxDr;boxH;boxHD;boxHU;boxHd;\
boxHu;boxUL;boxUR;boxUl;boxUr;boxV;boxVH;boxVL;boxVR;boxVh;boxVl;boxVr;boxbox;boxdL;boxdR;boxdl;\
boxdr;boxh;boxhD;boxhU;boxhd;boxhu;boxminus;boxplus;boxtimes;boxuL;boxuR;boxul;boxur;boxv;boxvH;\
boxvL;boxvR;boxvh;boxvl;boxvr;bprime;breve;brvbar;bscr;bsemi;bsim;bsime;bsol;bsolb;bsolhsub;bull;\
bullet;bump;bumpE;bumpe;bumpeq;cacute;cap;capand;capbrcup;capcap;capcup;capdot;caps;caret;caron;\
ccaps;ccaron;ccedil;ccirc;ccups;ccupssm;cdot;cedil;cemptyv;cent;centerdot;cfr;chcy;check;checkmark;\
chi;cir;cirE;circ;circeq;circlearrowleft;circlearrowright;circledR;circledS;circledast;circledcirc;\
circleddash;cire;cirfnint;cirmid;cirscir;clubs;clubsuit;colon;colone;coloneq;comma;commat;comp;\
compfn;complement;complexes;cong;congdot;conint;copf;coprod;copy;copysr;crarr;cross;cscr;csub;csube;\
csup;csupe;ctdot;cudarrl;cudarrr;cuepr;cuesc;cularr;cularrp;cup;cupbrcap;cupcap;cupcup;cupdot;cupor;\
cups;curarr;curarrm;curlyeqprec;curlyeqsucc;curlyvee;curlywedge;curren;curvearrowleft;\
curvearrowright;cuvee;cuwed;cwconint;cwint;cylcty;dArr;dHar;dagger;daleth;darr;dash;dashv;dbkarow;\
dblac;dcaron;dcy;dd;ddagger;ddarr;ddotseq;deg;delta;demptyv;dfisht;dfr;dharl;dharr;diam;diamond;\
diamondsuit;diams;die;digamma;disin;div;divide;divideontimes;divonx;djcy;dlcorn;dlcrop;dollar;dopf;\
dot;doteq;doteqdot;dotminus;dotplus;dotsquare;doublebarwedge;downarrow;downdownarrows;\
downharpoonleft;downharpoonright;drbkarow;drcorn;drcrop;dscr;dscy;dsol;dstrok;dtdot;dtri;dtrif;\
duarr;duhar;dwangle;dzcy;dzigrarr;eDDot;eDot;eacute;easter;ecaron;ecir;ecirc;ecolon;ecy;edot;ee;\
efDot;efr;eg;egrave;egs;egsdot;el;elinters;ell;els;elsdot;emacr;empty;emptyset;emptyv;emsp13;emsp14;\
emsp;eng;ensp;eogon;eopf;epar;eparsl;eplus;epsi;epsilon;epsiv;eqcirc;eqcolon;eqsim;eqslantgtr;\
eqslantless;equals;equest;equiv;equivDD;eqvparsl;erDot;erarr;escr;esdot;esim;eta;eth;euml;euro;excl;\
exist;expectation;exponentiale;fallingdotseq;fcy;female;ffilig;fflig;ffllig;ffr;filig;fjlig;flat;\
fllig;fltns;fnof;fopf;forall;fork;forkv;fpartint;frac12;frac13;frac14;frac15;frac16;frac18;frac23;\
frac25;frac34;frac35;frac38;frac45;frac56;frac58;frac78;frasl;frown;fscr;gE;gEl;gacute;gamma;gammad;\
gap;gbreve;gcirc;gcy;gdot;ge;gel;geq;geqq;geqslant;ges;gescc;gesdot;gesdoto;gesdotol;gesl;gesles;\
gfr;gg;ggg;gimel;gjcy;gl;glE;gla;glj;gnE;gnap;gnapprox;gne;gneq;gneqq;gnsim;gopf;grave;gscr;gsim;\
gsime;gsiml;gt;gtcc;gtcir;gtdot;gtlPar;gtquest;gtrapprox;gtrarr;gtrdot;gtreqless;gtreqqless;gtrless;\
gtrsim;gvertneqq;gvnE;hArr;hairsp;half;hamilt;hardcy;harr;harrcir;harrw;hbar;hcirc;hearts;heartsuit;\
hellip;hercon;hfr;hksearow;hkswarow;hoarr;homtht;hookleftarrow;hookrightarrow;hopf;horbar;hscr;\
hslash;hstrok;hybull;hyphen;iacute;ic;icirc;icy;iecy;iexcl;iff;ifr;igrave;ii;iiiint;iiint;iinfin;\
iiota;ijlig;imacr;image;imagline;imagpart;imath;imof;imped;in;incare;infin;infintie;inodot;int;\
intcal;integers;intercal;intlarhk;intprod;iocy;iogon;iopf;iota;iprod;iquest;iscr;isin;isinE;isindot;\
isins;isinsv;isinv;it;itilde;iukcy;iuml;jcirc;jcy;jfr;jmath;jopf;jscr;jsercy;jukcy;kappa;kappav;\
kcedil;kcy;kfr;kgreen;khcy;kjcy;kopf;kscr;lAarr;lArr;lAtail;lBarr;lE;lEg;lHar;lacute;laemptyv;\
lagran;lambda;lang;langd;langle;lap;laquo;larr;larrb;larrbfs;larrfs;larrhk;larrlp;larrpl;larrsim;\
larrtl;lat;latail;late;lates;lbarr;lbbrk;lbrace;lbrack;lbrke;lbrksld;lbrkslu;lcaron;lcedil;lceil;\
lcub;lcy;ldca;ldquo;ldquor;ldrdhar;ldrushar;ldsh;le;leftarrow;leftarrowtail;leftharpoondown;\
leftharpoonup;leftleftarrows;leftrightarrow;leftrightarrows;leftrightharpoons;leftrightsquigarrow;\
leftthreetimes;leg;leq;leqq;leqslant;les;lescc;lesdot;lesdoto;lesdotor;lesg;lesges;lessapprox;\
lessdot;lesseqgtr;lesseqqgtr;lessgtr;lesssim;lfisht;lfloor;lfr;lg;lgE;lhard;lharu;lharul;lhblk;ljcy;\
ll;llarr;llcorner;llhard;lltri;lmidot;lmoust;lmoustache;lnE;lnap;lnapprox;lne;lneq;lneqq;lnsim;\
loang;loarr;lobrk;longleftarrow;longleftrightarrow;longmapsto;longrightarrow;looparrowleft;\
looparrowright;lopar;lopf;loplus;lotimes;lowast;lowbar;loz;lozenge;lozf;lpar;lparlt;lrarr;lrcorner;\
lrhar;lrhard;lrm;lrtri;lsaquo;lscr;lsh;lsim;lsime;lsimg;lsqb;lsquo;lsquor;lstrok;lt;ltcc;ltcir;\
ltdot;lthree;ltimes;ltlarr;ltquest;ltrPar;ltri;ltrie;ltrif;lurdshar;luruhar;lvertneqq;lvnE;mDDot;\
macr;male;malt;maltese;map;mapsto;mapstodown;mapstoleft;mapstoup;marker;mcomma;mcy;mdash;\
measuredangle;mfr;mho;micro;mid;midast;midcir;middot;minus;minusb;minusd;minusdu;mlcp;mldr;mnplus;\
models;mopf;mp;mscr;mstpos;mu;multimap;mumap;nGg;nGt;nGtv;nLeftarrow;nLeftrightarrow;nLl;nLt;nLtv;\
nRightarrow;nVDash;nVdash;nabla;nacute;nang;nap;napE;napid;napos;napprox;natur;natural;naturals;\
nbsp;nbump;nbumpe;ncap;ncaron;ncedil;ncong;ncongdot;ncup;ncy;ndash;ne;neArr;nearhk;nearr;nearrow;\
nedot;nequiv;nesear;nesim;nexist;nexists;nfr;ngE;nge;ngeq;ngeqq;ngeqslant;nges;ngsim;ngt;ngtr;nhArr;\
nharr;nhpar;ni;nis;nisd;niv;njcy;nlArr;nlE;nlarr;nldr;nle;nleftarrow;nleftrightarrow;nleq;nleqq;\
nleqslant;nles;nless;nlsim;nlt;nltri;nltrie;nmid;nopf;not;notin;notinE;notindot;notinva;notinvb;\
notinvc;notni;notniva;notnivb;notnivc;npar;nparallel;nparsl;npart;npolint;npr;nprcue;npre;nprec;\
npreceq;nrArr;nrarr;nrarrc;nrarrw;nrightarrow;nrtri;nrtrie;nsc;nsccue;nsce;nscr;nshortmid;\
nshortparallel;nsim;nsime;nsimeq;nsmid;nspar;nsqsube;nsqsupe;nsub;nsubE;nsube;nsubset;nsubseteq;\
nsubseteqq;nsucc;nsucceq;nsup;nsupE;nsupe;nsupset;nsupseteq;nsupseteqq;ntgl;ntilde;ntlg;\
ntriangleleft;ntrianglelefteq;ntriangleright;ntrianglerighteq;nu;num;numero;numsp;nvDash;nvHarr;\
nvap;nvdash;nvge;nvgt;nvinfin;nvlArr;nvle;nvlt;nvltrie;nvrArr;nvrtrie;nvsim;nwArr;nwarhk;nwarr;\
nwarrow;nwnear;oS;oacute;oast;ocir;ocirc;ocy;odash;odblac;odiv;odot;odsold;oelig;ofcir;ofr;ogon;\
ograve;ogt;ohbar;ohm;oint;olarr;olcir;olcross;oline;olt;omacr;omega;omicron;omid;ominus;oopf;opar;\
operp;oplus;or;orarr;ord;order;orderof;ordf;ordm;origof;oror;orslope;orv;oscr;oslash;osol;otilde;\
otimes;otimesas;ouml;ovbar;par;para;parallel;parsim;parsl;part;pcy;percnt;period;permil;perp;\
pertenk;pfr;phi;phiv;phmmat;phone;pi;pitchfork;piv;planck;planckh;plankv;plus;plusacir;plusb;\
pluscir;plusdo;plusdu;pluse;plusmn;plussim;plustwo;pm;pointint;popf;pound;pr;prE;prap;prcue;pre;\
prec;precapprox;preccurlyeq;preceq;precnapprox;precneqq;precnsim;precsim;prime;primes;prnE;prnap;\
prnsim;prod;profalar;profline;profsurf;prop;propto;prsim;prurel;pscr;psi;puncsp;qfr;qint;qopf;\
qprime;qscr;quaternions;quatint;quest;questeq;quot;rAarr;rArr;rAtail;rBarr;rHar;race;racute;radic;\
raemptyv;rang;rangd;range;rangle;raquo;rarr;rarrap;rarrb;rarrbfs;rarrc;rarrfs;rarrhk;rarrlp;rarrpl;\
rarrsim;rarrtl;rarrw;ratail;ratio;rationals;rbarr;rbbrk;rbrace;rbrack;rbrke;rbrksld;rbrkslu;rcaron;\
rcedil;rceil;rcub;rcy;rdca;rdldhar;rdquo;rdquor;rdsh;real;realine;realpart;reals;rect;reg;rfisht;\
rfloor;rfr;rhard;rharu;rharul;rho;rhov;rightarrow;rightarrowtail;rightharpoondown;rightharpoonup;\
rightleftarrows;rightleftharpoons;rightrightarrows;rightsquigarrow;rightthreetimes;ring;\
risingdotseq;rlarr;rlhar;rlm;rmoust;rmoustache;rnmid;roang;roarr;robrk;ropar;ropf;roplus;rotimes;\
rpar;rpargt;rppolint;rrarr;rsaquo;rscr;rsh;rsqb;rsquo;rsquor;rthree;rtimes;rtri;rtrie;rtrif;\
rtriltri;ruluhar;rx;sacute;sbquo;sc;scE;scap;scaron;sccue;sce;scedil;scirc;scnE;scnap;scnsim;\
scpolint;scsim;scy;sdot;sdotb;sdote;seArr;searhk;searr;searrow;sect;semi;seswar;setminus;setmn;sext;\
sfr;sfrown;sharp;shchcy;shcy;shortmid;shortparallel;shy;sigma;sigmaf;sigmav;sim;simdot;sime;simeq;\
simg;simgE;siml;simlE;simne;simplus;simrarr;slarr;smallsetminus;smashp;smeparsl;smid;smile;smt;smte;\
smtes;softcy;sol;solb;solbar;sopf;spades;spadesuit;spar;sqcap;sqcaps;sqcup;sqcups;sqsub;sqsube;\
sqsubset;sqsubseteq;sqsup;sqsupe;sqsupset;sqsupseteq;squ;square;squarf;squf;srarr;sscr;ssetmn;\
ssmile;sstarf;star;starf;straightepsilon;straightphi;strns;sub;subE;subdot;sube;subedot;submult;\
subnE;subne;subplus;subrarr;subset;subseteq;subseteqq;subsetneq;subsetneqq;subsim;subsub;subsup;\
succ;succapprox;succcurlyeq;succeq;succnapprox;succneqq;succnsim;succsim;sum;sung;sup1;sup2;sup3;\
sup;supE;supdot;supdsub;supe;supedot;suphsol;suphsub;suplarr;supmult;supnE;supne;supplus;supset;\
supseteq;supseteqq;supsetneq;supsetneqq;supsim;supsub;supsup;swArr;swarhk;swarr;swarrow;swnwar;\
szlig;target;tau;tbrk;tcaron;tcedil;tcy;tdot;telrec;tfr;there4;therefore;theta;thetasym;thetav;\
thickapprox;thicksim;thinsp;thkap;thksim;thorn;tilde;times;timesb;timesbar;timesd;tint;toea;top;\
topbot;topcir;topf;topfork;tosa;tprime;trade;triangle;triangledown;triangleleft;trianglelefteq;\
triangleq;triangleright;trianglerighteq;tridot;trie;triminus;triplus;trisb;tritime;trpezium;tscr;\
tscy;tshcy;tstrok;twixt;twoheadleftarrow;twoheadrightarrow;uArr;uHar;uacute;uarr;ubrcy;ubreve;ucirc;\
ucy;udarr;udblac;udhar;ufisht;ufr;ugrave;uharl;uharr;uhblk;ulcorn;ulcorner;ulcrop;ultri;umacr;uml;\
uogon;uopf;uparrow;updownarrow;upharpoonleft;upharpoonright;uplus;upsi;upsih;upsilon;upuparrows;\
urcorn;urcorner;urcrop;uring;urtri;uscr;utdot;utilde;utri;utrif;uuarr;uuml;uwangle;vArr;vBar;vBarv;\
vDash;vangrt;varepsilon;varkappa;varnothing;varphi;varpi;varpropto;varr;varrho;varsigma;\
varsubsetneq;varsubsetneqq;varsupsetneq;varsupsetneqq;vartheta;vartriangleleft;vartriangleright;vcy;\
vdash;vee;veebar;veeeq;vellip;verbar;vert;vfr;vltri;vnsub;vnsup;vopf;vprop;vrtri;vscr;vsubnE;vsubne;\
vsupnE;vsupne;vzigzag;wcirc;wedbar;wedge;wedgeq;weierp;wfr;wopf;wp;wr;wreath;wscr;xcap;xcirc;xcup;\
xdtri;xfr;xhArr;xharr;xi;xlArr;xlarr;xmap;xnis;xodot;xopf;xoplus;xotime;xrArr;xrarr;xscr;xsqcup;\
xuplus;xutri;xvee;xwedge;yacute;yacy;ycirc;ycy;yen;yfr;yicy;yopf;yscr;yucy;yuml;zacute;zcaron;zcy;\
zdot;zeetrf;zeta;zfr;zhcy;zigrarr;zopf;zscr;zwj;zwnj;";

#[rustfmt::skip]
static NAME_OFFSETS: [u16; 2126] = [
    0, 6, 10, 17, 24, 30, 34, 38, 45, 51, 57, 61, 67, 72, 86, 92,
    97, 104, 111, 116, 126, 131, 138, 142, 150, 161, 166, 170, 175, 181, 186, 193,
    198, 203, 210, 214, 235, 243, 250, 257, 263, 271, 276, 284, 294, 298, 302, 312,
    324, 335, 347, 372, 394, 410, 416, 423, 433, 440, 456, 461, 471, 503, 509, 514,
    518, 525, 528, 537, 542, 547, 552, 559, 564, 570, 577, 581, 585, 591, 595, 612,
    627, 650, 667, 684, 692, 706, 711, 715, 722, 731, 753, 763, 779, 795, 816, 830,
    850, 875, 896, 913, 928, 942, 960, 978, 988, 1001, 1018, 1028, 1048, 1066, 1081, 1099,
    1118, 1134, 1153, 1161, 1174, 1184, 1189, 1196, 1200, 1204, 1211, 1218, 1224, 1228, 1233, 1237,
    1244, 1252, 1258, 1275, 1296, 1302, 1307, 1315, 1321, 1332, 1344, 1349, 1354, 1358, 1363, 1370,
    1383, 1387, 1391, 1409, 1431, 1436, 1443, 1454, 1459, 1464, 1467, 1473, 1480, 1487, 1494, 1500,
    1504, 1509, 1513, 1516, 1521, 1534, 1551, 1568, 1583, 1595, 1613, 1626, 1631, 1634, 1641, 1647,
    1651, 1657, 1661, 1674, 1679, 1694, 1699, 1706, 1719, 1729, 1734, 1740, 1745, 1752, 1758, 1762,
    1767, 1771, 1778, 1781, 1787, 1798, 1806, 1810, 1819, 1832, 1847, 1862, 1868, 1873, 1878, 1883,
    1890, 1896, 1901, 1907, 1911, 1915, 1920, 1925, 1932, 1938, 1943, 1948, 1954, 1961, 1965, 1969,
    1974, 1979, 1984, 1987, 1994, 2001, 2006, 2017, 2022, 2029, 2036, 2040, 2057, 2067, 2080, 2100,
    2112, 2130, 2148, 2163, 2181, 2191, 2206, 2222, 2230, 2243, 2257, 2270, 2286, 2304, 2321, 2337,
    2350, 2366, 2377, 2391, 2401, 2416, 2433, 2447, 2459, 2468, 2483, 2493, 2497, 2500, 2511, 2518,
    2532, 2551, 2566, 2580, 2599, 2614, 2619, 2634, 2650, 2655, 2659, 2666, 2669, 2673, 2677, 2689,
    2699, 2703, 2713, 2718, 2723, 2726, 2731, 2738, 2745, 2752, 2756, 2776, 2795, 2813, 2835, 2856,
    2871, 2879, 2883, 2891, 2908, 2913, 2917, 2930, 2940, 2961, 2972, 2981, 2995, 3005, 3016, 3032,
    3052, 3070, 3085, 3106, 3122, 3138, 3151, 3167, 3186, 3207, 3215, 3228, 3243, 3255, 3273, 3286,
    3310, 3328, 3340, 3357, 3379, 3397, 3414, 3434, 3456, 3472, 3493, 3511, 3534, 3544, 3559, 3571,
    3588, 3610, 3627, 3639, 3656, 3665, 3679, 3697, 3711, 3726, 3731, 3738, 3741, 3747, 3754, 3760,
    3764, 3771, 3775, 3782, 3788, 3794, 3802, 3807, 3828, 3843, 3846, 3851, 3858, 3865, 3872, 3877,
    3885, 3895, 3907, 3923, 3932, 3936, 3940, 3944, 3947, 3957, 3971, 3976, 3979, 3988, 4002, 4021,
    4035, 4041, 4049, 4060, 4073, 4078, 4082, 4087, 4091, 4096, 4101, 4107, 4111, 4118, 4123, 4128,
    4135, 4142, 4149, 4153, 4156, 4171, 4190, 4211, 4215, 4219, 4237, 4248, 4262, 4282, 4295, 4314,
    4333, 4349, 4368, 4379, 4388, 4402, 4417, 4431, 4448, 4467, 4485, 4502, 4516, 4533, 4545, 4560,
    4571, 4576, 4589, 4601, 4606, 4610, 4622, 4629, 4634, 4641, 4648, 4651, 4658, 4665, 4671, 4675,
    4679, 4694, 4709, 4725, 4738, 4744, 4756, 4761, 4766, 4773, 4792, 4805, 4823, 4838, 4858, 4870,
    4875, 4880, 4884, 4891, 4903, 4912, 4926, 4945, 4959, 4968, 4972, 4976, 4985, 4999, 5006, 5012,
    5018, 5024, 5029, 5033, 5037, 5044, 5051, 5055, 5059, 5069, 5075, 5086, 5096, 5102, 5113, 5128,
    5139, 5144, 5154, 5159, 5166, 5173, 5178, 5187, 5193, 5200, 5206, 5210, 5217, 5221, 5228, 5234,
    5243, 5254, 5267, 5284, 5290, 5300, 5306, 5311, 5319, 5330, 5347, 5359, 5373, 5379, 5390, 5398,
    5410, 5425, 5441, 5446, 5454, 5460, 5465, 5472, 5477, 5483, 5488, 5492, 5498, 5505, 5509, 5516,
    5521, 5533, 5546, 5564, 5578, 5592, 5596, 5601, 5606, 5613, 5619, 5625, 5629, 5634, 5639, 5643,
    5646, 5651, 5656, 5661, 5666, 5671, 5678, 5684, 5688, 5692, 5697, 5702, 5707, 5712, 5719, 5726,
    5730, 5735, 5750, 5755, 5759, 5764, 5769, 5776, 5783, 5786, 5790, 5794, 5800, 5806, 5810, 5816,
    5819, 5823, 5830, 5838, 5844, 5850, 5856, 5862, 5866, 5870, 5877, 5882, 5891, 5896, 5900, 5905,
    5911, 5918, 5927, 5936, 5945, 5954, 5963, 5972, 5981, 5990, 5996, 6004, 6013, 6020, 6026, 6034,
    6040, 6045, 6048, 6052, 6059, 6063, 6068, 6073, 6080, 6089, 6095, 6100, 6104, 6110, 6118, 6125,
    6130, 6139, 6145, 6150, 6159, 6171, 6181, 6189, 6199, 6206, 6213, 6222, 6227, 6236, 6242, 6246,
    6252, 6259, 6267, 6275, 6281, 6288, 6293, 6298, 6306, 6310, 6317, 6325, 6332, 6340, 6349, 6359,
    6368, 6376, 6392, 6406, 6415, 6422, 6431, 6438, 6451, 6463, 6477, 6495, 6513, 6532, 6538, 6544,
    6550, 6556, 6562, 6566, 6574, 6579, 6584, 6588, 6595, 6602, 6608, 6614, 6620, 6626, 6631, 6637,
    6643, 6649, 6655, 6661, 6667, 6673, 6679, 6684, 6690, 6696, 6702, 6708, 6714, 6720, 6727, 6733,
    6739, 6745, 6751, 6756, 6762, 6768, 6774, 6780, 6789, 6797, 6806, 6812, 6818, 6824, 6830, 6835,
    6841, 6847, 6853, 6859, 6865, 6871, 6878, 6884, 6891, 6896, 6902, 6907, 6913, 6918, 6924, 6933,
    6938, 6945, 6950, 6956, 6962, 6969, 6976, 6980, 6987, 6996, 7003, 7010, 7017, 7022, 7028, 7034,
    7040, 7047, 7054, 7060, 7066, 7074, 7079, 7085, 7093, 7098, 7108, 7112, 7117, 7123, 7133, 7137,
    7141, 7146, 7151, 7158, 7174, 7191, 7200, 7209, 7220, 7232, 7244, 7249, 7258, 7265, 7273, 7279,
    7288, 7294, 7301, 7309, 7315, 7322, 7327, 7334, 7345, 7355, 7360, 7368, 7375, 7380, 7387, 7392,
    7399, 7405, 7411, 7416, 7421, 7427, 7432, 7438, 7444, 7452, 7460, 7466, 7472, 7479, 7487, 7491,
    7500, 7507, 7514, 7521, 7527, 7532, 7539, 7547, 7559, 7571, 7580, 7591, 7598, 7613, 7629, 7635,
    7641, 7650, 7656, 7663, 7668, 7673, 7680, 7687, 7692, 7697, 7703, 7711, 7717, 7724, 7728, 7731,
    7739, 7745, 7753, 7757, 7763, 7771, 7778, 7782, 7788, 7794, 7799, 7807, 7819, 7825, 7829, 7837,
    7843, 7847, 7854, 7868, 7875, 7880, 7887, 7894, 7901, 7906, 7910, 7916, 7925, 7934, 7942, 7952,
    7967, 7977, 7992, 8008, 8025, 8034, 8041, 8048, 8053, 8058, 8063, 8070, 8076, 8081, 8087, 8093,
    8099, 8107, 8112, 8121, 8127, 8132, 8139, 8146, 8153, 8158, 8164, 8171, 8175, 8180, 8183, 8189,
    8193, 8196, 8203, 8207, 8214, 8217, 8226, 8230, 8234, 8241, 8247, 8253, 8262, 8269, 8276, 8283,
    8288, 8292, 8297, 8303, 8308, 8313, 8320, 8326, 8331, 8339, 8345, 8352, 8360, 8366, 8377, 8389,
    8396, 8403, 8409, 8417, 8426, 8432, 8438, 8443, 8449, 8454, 8458, 8462, 8467, 8472, 8477, 8483,
    8495, 8508, 8522, 8526, 8533, 8540, 8546, 8553, 8557, 8563, 8569, 8574, 8580, 8586, 8591, 8596,
    8603, 8608, 8614, 8623, 8630, 8637, 8644, 8651, 8658, 8665, 8672, 8679, 8686, 8693, 8700, 8707,
    8714, 8721, 8728, 8734, 8740, 8745, 8748, 8752, 8759, 8765, 8772, 8776, 8783, 8789, 8793, 8798,
    8801, 8805, 8809, 8814, 8823, 8827, 8833, 8840, 8848, 8857, 8862, 8869, 8873, 8876, 8880, 8886,
    8891, 8894, 8898, 8902, 8906, 8910, 8915, 8924, 8928, 8933, 8939, 8945, 8950, 8956, 8961, 8966,
    8972, 8978, 8981, 8986, 8992, 8998, 9005, 9013, 9023, 9030, 9037, 9047, 9058, 9066, 9073, 9083,
    9088, 9093, 9100, 9105, 9112, 9119, 9124, 9132, 9138, 9143, 9149, 9156, 9166, 9173, 9180, 9184,
    9193, 9202, 9208, 9215, 9229, 9244, 9249, 9256, 9261, 9268, 9275, 9282, 9289, 9296, 9299, 9305,
    9309, 9314, 9320, 9324, 9328, 9335, 9338, 9345, 9351, 9358, 9364, 9370, 9376, 9382, 9391, 9400,
    9406, 9411, 9417, 9420, 9427, 9433, 9442, 9449, 9453, 9460, 9469, 9478, 9487, 9495, 9500, 9506,
    9511, 9516, 9522, 9529, 9534, 9539, 9545, 9553, 9559, 9566, 9572, 9575, 9582, 9588, 9593, 9599,
    9603, 9607, 9613, 9618, 9623, 9630, 9636, 9642, 9649, 9656, 9660, 9664, 9671, 9676, 9681, 9686,
    9691, 9697, 9702, 9709, 9715, 9718, 9722, 9727, 9734, 9743, 9750, 9757, 9762, 9768, 9775, 9779,
    9785, 9790, 9796, 9804, 9811, 9818, 9825, 9832, 9840, 9847, 9851, 9858, 9863, 9869, 9875, 9881,
    9888, 9895, 9901, 9909, 9917, 9924, 9931, 9937, 9942, 9946, 9951, 9957, 9964, 9972, 9981, 9986,
    9989, 9999, 10013, 10029, 10043, 10058, 10073, 10089, 10107, 10127, 10142, 10146, 10150, 10155, 10164, 10168,
    10174, 10181, 10189, 10198, 10203, 10210, 10221, 10229, 10239, 10250, 10258, 10266, 10273, 10280, 10284, 10287,
    10291, 10297, 10303, 10310, 10316, 10321, 10324, 10330, 10339, 10346, 10352, 10359, 10366, 10377, 10381, 10386,
    10395, 10399, 10404, 10410, 10416, 10422, 10428, 10434, 10448, 10467, 10478, 10493, 10507, 10522, 10528, 10533,
    10540, 10548, 10555, 10562, 10566, 10574, 10579, 10584, 10591, 10597, 10606, 10612, 10619, 10623, 10629, 10636,
    10641, 10645, 10650, 10656, 10662, 10667, 10673, 10680, 10687, 10690, 10695, 10701, 10707, 10714, 10721, 10728,
    10736, 10743, 10748, 10754, 10760, 10769, 10777, 10787, 10792, 10798, 10803, 10808, 10813, 10821, 10825, 10832,
    10843, 10854, 10863, 10870, 10877, 10881, 10887, 10901, 10905, 10909, 10915, 10919, 10926, 10933, 10940, 10946,
    10953, 10960, 10968, 10973, 10978, 10985, 10992, 10997, 11000, 11005, 11012, 11015, 11024, 11030, 11034, 11038,
    11043, 11054, 11070, 11074, 11078, 11083, 11095, 11102, 11109, 11115, 11122, 11127, 11131, 11136, 11142, 11148,
    11156, 11162, 11170, 11179, 11184, 11190, 11197, 11202, 11209, 11216, 11222, 11231, 11236, 11240, 11246, 11249,
    11255, 11262, 11268, 11276, 11282, 11289, 11296, 11302, 11309, 11317, 11321, 11325, 11329, 11334, 11340, 11350,
    11355, 11361, 11365, 11370, 11376, 11382, 11388, 11391, 11395, 11400, 11404, 11409, 11415, 11419, 11425, 11430,
    11434, 11445, 11461, 11466, 11472, 11482, 11487, 11493, 11499, 11503, 11509, 11516, 11521, 11526, 11530, 11536,
    11543, 11552, 11560, 11568, 11576, 11582, 11590, 11598, 11606, 11611, 11621, 11628, 11634, 11642, 11646, 11653,
    11658, 11664, 11672, 11678, 11684, 11691, 11698, 11710, 11716, 11723, 11727, 11734, 11739, 11744, 11754, 11769,
    11774, 11780, 11787, 11793, 11799, 11807, 11815, 11820, 11826, 11832, 11840, 11850, 11861, 11867, 11875, 11880,
    11886, 11892, 11900, 11910, 11921, 11926, 11933, 11938, 11952, 11968, 11983, 12000, 12003, 12007, 12014, 12020,
    12027, 12034, 12039, 12046, 12051, 12056, 12064, 12071, 12076, 12081, 12089, 12096, 12104, 12110, 12116, 12123,
    12129, 12137, 12144, 12147, 12154, 12159, 12164, 12170, 12174, 12180, 12187, 12192, 12197, 12204, 12210, 12216,
    12220, 12225, 12232, 12236, 12242, 12246, 12251, 12257, 12263, 12271, 12277, 12281, 12287, 12293, 12301, 12306,
    12313, 12318, 12323, 12329, 12335, 12338, 12344, 12348, 12354, 12362, 12367, 12372, 12379, 12384, 12392, 12396,
    12401, 12408, 12413, 12420, 12427, 12436, 12441, 12447, 12451, 12456, 12465, 12472, 12478, 12483, 12487, 12494,
    12501, 12508, 12513, 12521, 12525, 12529, 12534, 12541, 12547, 12550, 12560, 12564, 12571, 12579, 12586, 12591,
    12600, 12606, 12614, 12621, 12628, 12634, 12641, 12649, 12657, 12660, 12669, 12674, 12680, 12683, 12687, 12692,
    12698, 12702, 12707, 12718, 12730, 12737, 12749, 12758, 12767, 12775, 12781, 12788, 12793, 12799, 12806, 12811,
    12820, 12829, 12838, 12843, 12850, 12856, 12863, 12868, 12872, 12879, 12883, 12888, 12893, 12900, 12905, 12917,
    12925, 12931, 12939, 12944, 12950, 12955, 12962, 12968, 12973, 12978, 12985, 12991, 13000, 13005, 13011, 13017,
    13024, 13030, 13035, 13042, 13048, 13056, 13062, 13069, 13076, 13083, 13090, 13098, 13105, 13111, 13118, 13124,
    13134, 13140, 13146, 13153, 13160, 13166, 13174, 13182, 13189, 13196, 13202, 13207, 13211, 13216, 13224, 13230,
    13237, 13242, 13247, 13255, 13264, 13270, 13275, 13279, 13286, 13293, 13297, 13303, 13309, 13316, 13320, 13325,
    13336, 13351, 13368, 13383, 13399, 13417, 13434, 13450, 13466, 13471, 13484, 13490, 13496, 13500, 13507, 13518,
    13524, 13530, 13536, 13542, 13548, 13553, 13560, 13568, 13573, 13580, 13589, 13595, 13602, 13607, 13611, 13616,
    13622, 13629, 13636, 13643, 13648, 13654, 13660, 13669, 13677, 13680, 13687, 13693, 13696, 13700, 13705, 13712,
    13718, 13722, 13729, 13735, 13740, 13746, 13753, 13762, 13768, 13772, 13777, 13783, 13789, 13795, 13802, 13808,
    13816, 13821, 13826, 13833, 13842, 13848, 13853, 13857, 13864, 13870, 13877, 13882, 13891, 13905, 13909, 13915,
    13922, 13929, 13933, 13940, 13945, 13951, 13956, 13962, 13967, 13973, 13979, 13987, 13995, 14001, 14015, 14022,
    14031, 14036, 14042, 14046, 14051, 14057, 14064, 14068, 14073, 14080, 14085, 14092, 14102, 14107, 14113, 14120,
    14126, 14133, 14139, 14146, 14155, 14166, 14172, 14179, 14188, 14199, 14203, 14210, 14217, 14222, 14228, 14233,
    14240, 14247, 14254, 14259, 14265, 14281, 14293, 14299, 14303, 14308, 14315, 14320, 14328, 14336, 14342, 14348,
    14356, 14364, 14371, 14380, 14390, 14400, 14411, 14418, 14425, 14432, 14437, 14448, 14460, 14467, 14479, 14488,
    14497, 14505, 14509, 14514, 14519, 14524, 14529, 14533, 14538, 14545, 14553, 14558, 14566, 14574, 14582, 14590,
    14598, 14604, 14610, 14618, 14625, 14634, 14644, 14654, 14665, 14672, 14679, 14686, 14692, 14699, 14705, 14713,
    14720, 14726, 14733, 14737, 14742, 14749, 14756, 14760, 14765, 14772, 14776, 14783, 14793, 14799, 14808, 14815,
    14827, 14836, 14843, 14849, 14856, 14862, 14868, 14874, 14881, 14890, 14897, 14902, 14907, 14911, 14918, 14925,
    14930, 14938, 14943, 14950, 14956, 14965, 14978, 14991, 15006, 15016, 15030, 15046, 15053, 15058, 15067, 15075,
    15081, 15089, 15098, 15103, 15108, 15114, 15121, 15127, 15144, 15162, 15167, 15172, 15179, 15184, 15190, 15197,
    15203, 15207, 15213, 15220, 15226, 15233, 15237, 15244, 15250, 15256, 15262, 15269, 15278, 15285, 15291, 15297,
    15301, 15307, 15312, 15320, 15332, 15346, 15361, 15367, 15372, 15378, 15386, 15397, 15404, 15413, 15420, 15426,
    15432, 15437, 15443, 15450, 15455, 15461, 15467, 15472, 15480, 15485, 15490, 15496, 15502, 15509, 15520, 15529,
    15540, 15547, 15553, 15563, 15568, 15575, 15584, 15597, 15611, 15624, 15638, 15647, 15663, 15680, 15684, 15690,
    15694, 15701, 15707, 15714, 15721, 15726, 15730, 15736, 15742, 15748, 15753, 15759, 15765, 15770, 15777, 15784,
    15791, 15798, 15806, 15812, 15819, 15825, 15832, 15839, 15843, 15848, 15851, 15854, 15861, 15866, 15871, 15877,
    15882, 15888, 15892, 15898, 15904, 15907, 15913, 15919, 15924, 15929, 15935, 15940, 15947, 15954, 15960, 15966,
    15971, 15978, 15985, 15991, 15996, 16003, 16010, 16015, 16021, 16025, 16029, 16033, 16038, 16043, 16048, 16053,
    16058, 16065, 16072, 16076, 16081, 16088, 16093, 16097, 16102, 16110, 16115, 16120, 16124, 16129,
];

/// First codepoint of each entity, `HAS_SECOND` marking the two-codepoint ones.
#[rustfmt::skip]
static CODEPOINTS: [u32; 2125] = [
    198, 38, 193, 258, 194, 1040, 120068, 192, 913, 256, 10835, 260,
    120120, 8289, 197, 119964, 8788, 195, 196, 8726, 10983, 8966, 1041, 8757,
    8492, 914, 120069, 120121, 728, 8492, 8782, 1063, 169, 262, 8914, 8517,
    8493, 268, 199, 264, 8752, 266, 184, 183, 8493, 935, 8857, 8854,
    8853, 8855, 8754, 8221, 8217, 8759, 10868, 8801, 8751, 8750, 8450, 8720,
    8755, 10799, 119966, 8915, 8781, 8517, 10513, 1026, 1029, 1039, 8225, 8609,
    10980, 270, 1044, 8711, 916, 120071, 180, 729, 733, 96, 732, 8900,
    8518, 120123, 168, 8412, 8784, 8751, 168, 8659, 8656, 8660, 10980, 10232,
    10234, 10233, 8658, 8872, 8657, 8661, 8741, 8595, 10515, 8693, 785, 10576,
    10590, 8637, 10582, 10591, 8641, 10583, 8868, 8615, 8659, 119967, 272, 330,
    208, 201, 282, 202, 1069, 278, 120072, 200, 8712, 274, 9723, 9643,
    280, 120124, 917, 10869, 8770, 8652, 8496, 10867, 919, 203, 8707, 8519,
    1060, 120073, 9724, 9642, 120125, 8704, 8497, 8497, 1027, 62, 915, 988,
    286, 290, 284, 1043, 288, 120074, 8921, 120126, 8805, 8923, 8807, 10914,
    8823, 10878, 8819, 119970, 8811, 1066, 711, 94, 292, 8460, 8459, 8461,
    9472, 8459, 294, 8782, 8783, 1045, 306, 1025, 205, 206, 1048, 304,
    8465, 204, 8465, 298, 8520, 8658, 8748, 8747, 8898, 8291, 8290, 302,
    120128, 921, 8464, 296, 1030, 207, 308, 1049, 120077, 120129, 119973, 1032,
    1028, 1061, 1036, 922, 310, 1050, 120078, 120130, 119974, 1033, 60, 313,
    923, 10218, 8466, 8606, 317, 315, 1051, 10216, 8592, 8676, 8646, 8968,
    10214, 10593, 8643, 10585, 8970, 8596, 10574, 8867, 8612, 10586, 8882, 10703,
    8884, 10577, 10592, 8639, 10584, 8636, 10578, 8656, 8660, 8922, 8806, 8822,
    10913, 10877, 8818, 120079, 8920, 8666, 319, 10229, 10231, 10230, 10232, 10234,
    10233, 120131, 8601, 8600, 8466, 8624, 321, 8810, 10501, 1052, 8287, 8499,
    120080, 8723, 120132, 8499, 924, 1034, 323, 327, 325, 1053, 8203, 8203,
    8203, 8203, 8811, 8810, 10, 120081, 8288, 160, 8469, 10988, 8802, 8813,
    8742, 8713, 8800, 2147492418, 8708, 8815, 8817, 2147492455, 2147492459, 8825, 2147494526, 8821,
    2147492430, 2147492431, 8938, 2147494351, 8940, 8814, 8816, 8824, 2147492458, 2147494525, 8820, 2147494562,
    2147494561, 8832, 2147494575, 8928, 8716, 8939, 2147494352, 8941, 2147492495, 8930, 2147492496, 8931,
    2147492482, 8840, 8833, 2147494576, 8929, 2147492479, 2147492483, 8841, 8769, 8772, 8775, 8777,
    8740, 119977, 209, 925, 338, 211, 212, 1054, 336, 120082, 210, 332,
    937, 927, 120134, 8220, 8216, 10836, 119978, 216, 213, 10807, 214, 8254,
    9182, 9140, 9180, 8706, 1055, 120083, 934, 928, 177, 8460, 8473, 10939,
    8826, 10927, 8828, 8830, 8243, 8719, 8759, 8733, 119979, 936, 34, 120084,
    8474, 119980, 10512, 174, 340, 10219, 8608, 10518, 344, 342, 1056, 8476,
    8715, 8651, 10607, 8476, 929, 10217, 8594, 8677, 8644, 8969, 10215, 10589,
    8642, 10581, 8971, 8866, 8614, 10587, 8883, 10704, 8885, 10575, 10588, 8638,
    10580, 8640, 10579, 8658, 8477, 10608, 8667, 8475, 8625, 10740, 1065, 1064,
    1068, 346, 10940, 352, 350, 348, 1057, 120086, 8595, 8592, 8594, 8593,
    931, 8728, 120138, 8730, 9633, 8851, 8847, 8849, 8848, 8850, 8852, 119982,
    8902, 8912, 8912, 8838, 8827, 10928, 8829, 8831, 8715, 8721, 8913, 8835,
    8839, 8913, 222, 8482, 1035, 1062, 9, 932, 356, 354, 1058, 120087,
    8756, 920, 2147491935, 8201, 8764, 8771, 8773, 8776, 120139, 8411, 119983, 358,
    218, 8607, 10569, 1038, 364, 219, 1059, 368, 120088, 217, 362, 95,
    9183, 9141, 9181, 8899, 8846, 370, 120140, 8593, 10514, 8645, 8597, 10606,
    8869, 8613, 8657, 8661, 8598, 8599, 978, 933, 366, 119984, 360, 220,
    8875, 10987, 1042, 8873, 10982, 8897, 8214, 8214, 8739, 124, 10072, 8768,
    8202, 120089, 120141, 119985, 8874, 372, 8896, 120090, 120142, 119986, 120091, 926,
    120143, 119987, 1071, 1031, 1070, 221, 374, 1067, 120092, 120144, 119988, 376,
    1046, 377, 381, 1047, 379, 8203, 918, 8488, 8484, 119989, 225, 259,
    8766, 2147492414, 8767, 226, 180, 1072, 230, 8289, 120094, 224, 8501, 8501,
    945, 257, 10815, 38, 8743, 10837, 10844, 10840, 10842, 8736, 10660, 8736,
    8737, 10664, 10665, 10666, 10667, 10668, 10669, 10670, 10671, 8735, 8894, 10653,
    8738, 197, 9084, 261, 120146, 8776, 10864, 10863, 8778, 8779, 39, 8776,
    8778, 229, 119990, 42, 8776, 8781, 227, 228, 8755, 10769, 10989, 8780,
    1014, 8245, 8765, 8909, 8893, 8965, 8965, 9141, 9142, 8780, 1073, 8222,
    8757, 8757, 10672, 1014, 8492, 946, 8502, 8812, 120095, 8898, 9711, 8899,
    10752, 10753, 10754, 10758, 9733, 9661, 9651, 10756, 8897, 8896, 10509, 10731,
    9642, 9652, 9662, 9666, 9656, 9251, 9618, 9617, 9619, 9608, 2147483709, 2147492449,
    8976, 120147, 8869, 8869, 8904, 9559, 9556, 9558, 9555, 9552, 9574, 9577,
    9572, 9575, 9565, 9562, 9564, 9561, 9553, 9580, 9571, 9568, 9579, 9570,
    9567, 10697, 9557, 9554, 9488, 9484, 9472, 9573, 9576, 9516, 9524, 8863,
    8862, 8864, 9563, 9560, 9496, 9492, 9474, 9578, 9569, 9566, 9532, 9508,
    9500, 8245, 728, 166, 119991, 8271, 8765, 8909, 92, 10693, 10184, 8226,
    8226, 8782, 10926, 8783, 8783, 263, 8745, 10820, 10825, 10827, 10823, 10816,
    2147492393, 8257, 711, 10829, 269, 231, 265, 10828, 10832, 267, 184, 10674,
    162, 183, 120096, 1095, 10003, 10003, 967, 9675, 10691, 710, 8791, 8634,
    8635, 174, 9416, 8859, 8858, 8861, 8791, 10768, 10991, 10690, 9827, 9827,
    58, 8788, 8788, 44, 64, 8705, 8728, 8705, 8450, 8773, 10861, 8750,
    120148, 8720, 169, 8471, 8629, 10007, 119992, 10959, 10961, 10960, 10962, 8943,
    10552, 10549, 8926, 8927, 8630, 10557, 8746, 10824, 10822, 10826, 8845, 10821,
    2147492394, 8631, 10556, 8926, 8927, 8910, 8911, 164, 8630, 8631, 8910, 8911,
    8754, 8753, 9005, 8659, 10597, 8224, 8504, 8595, 8208, 8867, 10511, 733,
    271, 1076, 8518, 8225, 8650, 10871, 176, 948, 10673, 10623, 120097, 8643,
    8642, 8900, 8900, 9830, 9830, 168, 989, 8946, 247, 247, 8903, 8903,
    1106, 8990, 8973, 36, 120149, 729, 8784, 8785, 8760, 8724, 8865, 8966,
    8595, 8650, 8643, 8642, 10512, 8991, 8972, 119993, 1109, 10742, 273, 8945,
    9663, 9662, 8693, 10607, 10662, 1119, 10239, 10871, 8785, 233, 10862, 283,
    8790, 234, 8789, 1101, 279, 8519, 8786, 120098, 10906, 232, 10902, 10904,
    10905, 9191, 8467, 10901, 10903, 275, 8709, 8709, 8709, 8196, 8197, 8195,
    331, 8194, 281, 120150, 8917, 10723, 10865, 949, 949, 1013, 8790, 8789,
    8770, 10902, 10901, 61, 8799, 8801, 10872, 10725, 8787, 10609, 8495, 8784,
    8770, 951, 240, 235, 8364, 33, 8707, 8496, 8519, 8786, 1092, 9792,
    64259, 64256, 64260, 120099, 64257, 2147483750, 9837, 64258, 9649, 402, 120151, 8704,
    8916, 10969, 10765, 189, 8531, 188, 8533, 8537, 8539, 8532, 8534, 190,
    8535, 8540, 8536, 8538, 8541, 8542, 8260, 8994, 119995, 8807, 10892, 501,
    947, 989, 10886, 287, 285, 1075, 289, 8805, 8923, 8805, 8807, 10878,
    10878, 10921, 10880, 10882, 10884, 2147492571, 10900, 120100, 8811, 8921, 8503, 1107,
    8823, 10898, 10917, 10916, 8809, 10890, 10890, 10888, 10888, 8809, 8935, 120152,
    96, 8458, 8819, 10894, 10896, 62, 10919, 10874, 8919, 10645, 10876, 10886,
    10616, 8919, 8923, 10892, 8823, 8819, 2147492457, 2147492457, 8660, 8202, 189, 8459,
    1098, 8596, 10568, 8621, 8463, 293, 9829, 9829, 8230, 8889, 120101, 10533,
    10534, 8703, 8763, 8617, 8618, 120153, 8213, 119997, 8463, 295, 8259, 8208,
    237, 8291, 238, 1080, 1077, 161, 8660, 120102, 236, 8520, 10764, 8749,
    10716, 8489, 307, 299, 8465, 8464, 8465, 305, 8887, 437, 8712, 8453,
    8734, 10717, 305, 8747, 8890, 8484, 8890, 10775, 10812, 1105, 303, 120154,
    953, 10812, 191, 119998, 8712, 8953, 8949, 8948, 8947, 8712, 8290, 297,
    1110, 239, 309, 1081, 120103, 567, 120155, 119999, 1112, 1108, 954, 1008,
    311, 1082, 120104, 312, 1093, 1116, 120156, 120000, 8666, 8656, 10523, 10510,
    8806, 10891, 10594, 314, 10676, 8466, 955, 10216, 10641, 10216, 10885, 171,
    8592, 8676, 10527, 10525, 8617, 8619, 10553, 10611, 8610, 10923, 10521, 10925,
    2147494573, 10508, 10098, 123, 91, 10635, 10639, 10637, 318, 316, 8968, 123,
    1083, 10550, 8220, 8222, 10599, 10571, 8626, 8804, 8592, 8610, 8637, 8636,
    8647, 8596, 8646, 8651, 8621, 8907, 8922, 8804, 8806, 10877, 10877, 10920,
    10879, 10881, 10883, 2147492570, 10899, 10885, 8918, 8922, 10891, 8822, 8818, 10620,
    8970, 120105, 8822, 10897, 8637, 8636, 10602, 9604, 1113, 8810, 8647, 8990,
    10603, 9722, 320, 9136, 9136, 8808, 10889, 10889, 10887, 10887, 8808, 8934,
    10220, 8701, 10214, 10229, 10231, 10236, 10230, 8619, 8620, 10629, 120157, 10797,
    10804, 8727, 95, 9674, 9674, 10731, 40, 10643, 8646, 8991, 8651, 10605,
    8206, 8895, 8249, 120001, 8624, 8818, 10893, 10895, 91, 8216, 8218, 322,
    60, 10918, 10873, 8918, 8907, 8905, 10614, 10875, 10646, 9667, 8884, 9666,
    10570, 10598, 2147492456, 2147492456, 8762, 175, 9794, 10016, 10016, 8614, 8614, 8615,
    8612, 8613, 9646, 10793, 1084, 8212, 8737, 120106, 8487, 181, 8739, 42,
    10992, 183, 8722, 8863, 8760, 10794, 10971, 8230, 8723, 8871, 120158, 8723,
    120002, 8766, 956, 8888, 8888, 2147492569, 2147492459, 2147492459, 8653, 8654, 2147492568, 2147492458,
    2147492458, 8655, 8879, 8878, 8711, 324, 2147492384, 8777, 2147494512, 2147492427, 329, 8777,
    9838, 9838, 8469, 160, 2147492430, 2147492431, 10819, 328, 326, 8775, 2147494509, 10818,
    1085, 8211, 8800, 8663, 10532, 8599, 8599, 2147492432, 8802, 10536, 2147492418, 8708,
    8708, 120107, 2147492455, 8817, 8817, 2147492455, 2147494526, 2147494526, 8821, 8815, 8815, 8654,
    8622, 10994, 8715, 8956, 8954, 8715, 1114, 8653, 2147492454, 8602, 8229, 8816,
    8602, 8622, 8816, 2147492454, 2147494525, 2147494525, 8814, 8820, 8814, 8938, 8940, 8740,
    120159, 172, 8713, 2147492601, 2147492597, 8713, 8951, 8950, 8716, 8716, 8958, 8957,
    8742, 8742, 2147494653, 2147492354, 10772, 8832, 8928, 2147494575, 8832, 2147494575, 8655, 8603,
    2147494195, 2147492253, 8603, 8939, 8941, 8833, 8929, 2147494576, 120003, 8740, 8742, 8769,
    8772, 8772, 8740, 8742, 8930, 8931, 8836, 2147494597, 8840, 2147492482, 8840, 2147494597,
    8833, 2147494576, 8837, 2147494598, 8841, 2147492483, 8841, 2147494598, 8825, 241, 8824, 8938,
    8940, 8939, 8941, 957, 35, 8470, 8199, 8877, 10500, 2147492429, 8876, 2147492453,
    2147483710, 10718, 10498, 2147492452, 2147483708, 2147492532, 10499, 2147492533, 2147492412, 8662, 10531, 8598,
    8598, 10535, 9416, 243, 8859, 8858, 244, 1086, 8861, 337, 10808, 8857,
    10684, 339, 10687, 120108, 731, 242, 10689, 10677, 937, 8750, 8634, 10686,
    10683, 8254, 10688, 333, 969, 959, 10678, 8854, 120160, 10679, 10681, 8853,
    8744, 8635, 10845, 8500, 8500, 170, 186, 8886, 10838, 10839, 10843, 8500,
    248, 8856, 245, 8855, 10806, 246, 9021, 8741, 182, 8741, 10995, 11005,
    8706, 1087, 37, 46, 8240, 8869, 8241, 120109, 966, 981, 8499, 9742,
    960, 8916, 982, 8463, 8462, 8463, 43, 10787, 8862, 10786, 8724, 10789,
    10866, 177, 10790, 10791, 177, 10773, 120161, 163, 8826, 10931, 10935, 8828,
    10927, 8826, 10935, 8828, 10927, 10937, 10933, 8936, 8830, 8242, 8473, 10933,
    10937, 8936, 8719, 9006, 8978, 8979, 8733, 8733, 8830, 8880, 120005, 968,
    8200, 120110, 10764, 120162, 8279, 120006, 8461, 10774, 63, 8799, 34, 8667,
    8658, 10524, 10511, 10596, 2147492413, 341, 8730, 10675, 10217, 10642, 10661, 10217,
    187, 8594, 10613, 8677, 10528, 10547, 10526, 8618, 8620, 10565, 10612, 8611,
    8605, 10522, 8758, 8474, 10509, 10099, 125, 93, 10636, 10638, 10640, 345,
    343, 8969, 125, 1088, 10551, 10601, 8221, 8221, 8627, 8476, 8475, 8476,
    8477, 9645, 174, 10621, 8971, 120111, 8641, 8640, 10604, 961, 1009, 8594,
    8611, 8641, 8640, 8644, 8652, 8649, 8605, 8908, 730, 8787, 8644, 8652,
    8207, 9137, 9137, 10990, 10221, 8702, 10215, 10630, 120163, 10798, 10805, 41,
    10644, 10770, 8649, 8250, 120007, 8625, 93, 8217, 8217, 8908, 8906, 9657,
    8885, 9656, 10702, 10600, 8478, 347, 8218, 8827, 10932, 10936, 353, 8829,
    10928, 351, 349, 10934, 10938, 8937, 10771, 8831, 1089, 8901, 8865, 10854,
    8664, 10533, 8600, 8600, 167, 59, 10537, 8726, 8726, 10038, 120112, 8994,
    9839, 1097, 1096, 8739, 8741, 173, 963, 962, 962, 8764, 10858, 8771,
    8771, 10910, 10912, 10909, 10911, 8774, 10788, 10610, 8592, 8726, 10803, 10724,
    8739, 8995, 10922, 10924, 2147494572, 1100, 47, 10692, 9023, 120164, 9824, 9824,
    8741, 8851, 2147492499, 8852, 2147492500, 8847, 8849, 8847, 8849, 8848, 8850, 8848,
    8850, 9633, 9633, 9642, 9642, 8594, 120008, 8726, 8995, 8902, 9734, 9733,
    1013, 981, 175, 8834, 10949, 10941, 8838, 10947, 10945, 10955, 8842, 10943,
    10617, 8834, 8838, 10949, 8842, 10955, 10951, 10965, 10963, 8827, 10936, 8829,
    10928, 10938, 10934, 8937, 8831, 8721, 9834, 185, 178, 179, 8835, 10950,
    10942, 10968, 8839, 10948, 10185, 10967, 10619, 10946, 10956, 8843, 10944, 8835,
    8839, 10950, 8843, 10956, 10952, 10964, 10966, 8665, 10534, 8601, 8601, 10538,
    223, 8982, 964, 9140, 357, 355, 1090, 8411, 8981, 120113, 8756, 8756,
    952, 977, 977, 8776, 8764, 8201, 8776, 8764, 254, 732, 215, 8864,
    10801, 10800, 8749, 10536, 8868, 9014, 10993, 120165, 10970, 10537, 8244, 8482,
    9653, 9663, 9667, 8884, 8796, 9657, 8885, 9708, 8796, 10810, 10809, 10701,
    10811, 9186, 120009, 1094, 1115, 359, 8812, 8606, 8608, 8657, 10595, 250,
    8593, 1118, 365, 251, 1091, 8645, 369, 10606, 10622, 120114, 249, 8639,
    8638, 9600, 8988, 8988, 8975, 9720, 363, 168, 371, 120166, 8593, 8597,
    8639, 8638, 8846, 965, 978, 965, 8648, 8989, 8989, 8974, 367, 9721,
    120010, 8944, 361, 9653, 9652, 8648, 252, 10663, 8661, 10984, 10985, 8872,
    10652, 1013, 1008, 8709, 981, 982, 8733, 8597, 1009, 962, 2147492490, 2147494603,
    2147492491, 2147494604, 977, 8882, 8883, 1074, 8866, 8744, 8891, 8794, 8942, 124,
    124, 120115, 8882, 2147492482, 2147492483, 120167, 8733, 8883, 120011, 2147494603, 2147492490, 2147494604,
    2147492491, 10650, 373, 10847, 8743, 8793, 8472, 120116, 120168, 8472, 8768, 8768,
    120012, 8898, 9711, 8899, 9661, 120117, 10234, 10231, 958, 10232, 10229, 10236,
    8955, 10752, 120169, 10753, 10754, 10233, 10230, 120013, 10758, 10756, 9651, 8897,
    8896, 253, 1103, 375, 1099, 165, 120118, 1111, 120170, 120014, 1102, 255,
    378, 382, 1079, 380, 8488, 950, 120119, 1078, 8669, 120171, 120015, 8205,
    8204,
];

/// `(entity index, second codepoint)` for the two-codepoint entities, by index.
#[rustfmt::skip]
static SECOND_CODEPOINTS: [(u16, u32); 93] = [
    (315, 824), (319, 824), (320, 824), (322, 824), (324, 824), (325, 824), (327, 824), (332, 824),
    (333, 824), (335, 824), (336, 824), (338, 824), (342, 824), (344, 824), (346, 824), (348, 8402),
    (351, 824), (353, 824), (354, 8402), (506, 8202), (601, 819), (706, 8421), (707, 8421), (780, 65024),
    (852, 65024), (1001, 106), (1049, 65024), (1086, 65024), (1087, 65024), (1212, 65024), (1251, 65024), (1334, 65024),
    (1335, 65024), (1373, 824), (1374, 8402), (1375, 824), (1378, 824), (1379, 8402), (1380, 824), (1386, 8402),
    (1388, 824), (1389, 824), (1396, 824), (1397, 824), (1402, 824), (1411, 824), (1414, 824), (1418, 824),
    (1421, 824), (1422, 824), (1423, 824), (1436, 824), (1443, 824), (1444, 824), (1445, 824), (1455, 824),
    (1456, 824), (1466, 8421), (1467, 824), (1471, 824), (1473, 824), (1476, 824), (1477, 824), (1483, 824),
    (1495, 824), (1497, 8402), (1499, 824), (1501, 824), (1503, 824), (1505, 8402), (1507, 824), (1521, 8402),
    (1523, 8402), (1524, 8402), (1527, 8402), (1528, 8402), (1529, 8402), (1531, 8402), (1532, 8402), (1672, 817),
    (1828, 65024), (1838, 65024), (1840, 65024), (2038, 65024), (2039, 65024), (2040, 65024), (2041, 65024), (2055, 8402),
    (2056, 8402), (2061, 65024), (2062, 65024), (2063, 65024), (2064, 65024),
];
