// The programs of kept-attacks that are mostly a loop written out: thousands of fields, variables or functions that differ in a number. And those that are another program without its types.
import { family, programsOf, text, untypedTwins } from "../generate";

export const programs = () =>
  programsOf({
    "lists-of-constants/tables-small-s12-different.ts": text(
      `// Lists of constants: tables small  different. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { zmlrzecjt: 12, ufaqsmfgr: 289, qahyfhkvd: 242, zedufaosl: 853, vysejqjmp: 59, liqfgoavt: 407, plxmfsckx: 31, ibritvsjy: 729, qtgwjknkg: 144, yurdbzzkz: 169, resfjcfeo: 116, mtltjshnu: 430	1: Record<string, number> = { jzlomcbei: 459, stmkydqim: 964, raidtfuzn: 779, dqriiakcx: 166, omzpivulk: 568, lkxpokzry: 62, zfnhoogug: 684, fahplqvfw: 228, eqcitkhrw: 195, duywdxiat: 183, zwfvnvtcd: 24, hgmkftikz: 581	2: Record<string, number> = { lghuhnmyu: 965, rkubyliom: 461, tpgzmkurs: 984, vhifpeykt: 159, olpvdaywg: 544, ynfduhzxl: 498, pujpydlhe: 927, rdtdypsyi: 378, ttftewmmq: 234, hseoafoms: 705, oirtnisgp: 843, troornfqs: 754	3: Record<string, number> = { fvmpmcyzi: 99, eycocwrrp: 191, jghqynwrc: 573, bofbxxytb: 64, eqdemriai: 352, crhdjqobt: 84, ushwavnfb: 559, rktbfvjjo: 752, jdoeuegkc: 421, xfkszrmmo: 80, dihnaauau: 797, tbpwwfydh: 13	4: Record<string, number> = { ekbuzrfkq: 155, hcphiflvx: 316, bdzxqioys: 159, dkcjkanwv: 896, ruvdxifhj: 682, lqxrhjqko: 319, ipbtztkfk: 7, gklhwxumm: 375, hqaddnfyh: 405, pblgphuec: 80, xocuzgnyt: 960, rfeacomuz: 722
5: Record<string, number> = { lmkdqajet: 655, jbjejklvg: 726, ioywmfrfs: 779, obdkzaxxi: 7, qtjftjctv: 495, zelwrunth: 837, vjqxnmebt: 613, rgivvqmby: 600, hcdddpyqb: 975, rgvttjbhc: 959, bszmkgmwa: 784, byiuwpumz: 989	6: Record<string, number> = { yqjwvjvlh: 678, onqhnatec: 942, tlggxaovp: 533, mmiegrgdr: 368, xoowcxsyn: 674, matcfxnof: 887, pjiuxtgrv: 578, nsitulhez: 754, ecgfmdhia: 496, btvczovcp: 116, jqtpaxqau: 452, orzcowcce: 888	7: Record<string, number> = { szqcubwou: 767, qdfjfzldm: 138, poqotczvu: 367, hhuqombzp: 253, qgpfjyulj: 61, sbtdzajqi: 62, sgtljiwch: 795, yydopxjlu: 622, shmsmatvd: 86, svlwhkxyj: 795, qlciermzq: 994, ywslkwygk: 121	8: Record<string, number> = { ncyuniyzr: 22, zyasrnuso: 901, bimhdrlmf: 893, ddykmvftb: 851, jgvdoplnf: 512, qhwwlymit: 807, hkzekambv: 137, nlndofhic: 163, poeilljsw: 799, rxkqlfuql: 617, amlwttquu: 725, mowlluxkb: 514	9: Record<string, number> = { benbrqkym: 489, hshjgxxps: 11, cahusfvel: 736, bycefwwwp: 395, yvvmqxbhi: 955, rcavolgax: 731, aypjxkgsb: 218, hakqnzeho: 338, oyaopfnjo: 724, zslkqsecd: 192, pmesvvavq: 159, gilsjhcle: 877
10: Record<string, number> = { gcvboneas: 95, odhzynnaa: 595, rbausawbk: 901, ztnfwcttw: 311, twnwhmrzo: 369, bfozzuttf: 576, qhkzuepsh: 272, bfgnscvnr: 399, rltpescjv: 19, nkoypzkph: 675, stivrttus: 675, uustqkqoo: 402	11: Record<string, number> = { cjpzxlyzy: 829, yechdrrkj: 158, mvgtxvtdu: 490, yfqjhtedv: 173, commtziiu: 378, lzswjtgkp: 292, btcuyvquo: 752, lelojbcaw: 283, zflaqzorl: 878, sdikwtmwf: 728, yzabwqkml: 667, ebfiqpzuy: 451	12: Record<string, number> = { iteimvooi: 462, tjhkmrysr: 825, lltambgvl: 995, rtwesgauh: 772, oejqiucvz: 41, jfhcbpvck: 960, smygndpmd: 291, yuuxxzmrt: 35, oeniqqxrq: 114, ytgzfhnxo: 585, dlofpndzo: 755, ukykmnmua: 854	13: Record<string, number> = { enqlylizf: 145, samrokxmj: 230, zrywudzfm: 457, vypzganfm: 69, laibpkgco: 365, yxhgvqkzg: 790, bvpccdlrs: 375, qduqdprgd: 22, hlmrglpie: 612, mibmfbkie: 86, duykjsmxu: 639, ssqpcvlnc: 237	14: Record<string, number> = { scjmioekn: 224, eekbdukce: 338, faigwhvad: 318, lvtbwqipv: 865, aascdjfix: 21, qthqqmtim: 744, jbjemijqk: 683, tvdeiipau: 931, ynypdgyit: 332, ehxbdlesr: 363, ducuqojpz: 468, apkaaoikt: 670
15: Record<string, number> = { rxsntjums: 178, yiqsocotx: 957, hpheitrnh: 655, mdabnpwyz: 900, hbhjnzrxn: 988, gvtlcpzcp: 731, frlvudppm: 30, rolpudomp: 600, ebykoxikk: 646, ywqqghmzj: 201, vtynsgzqz: 91, iqjacoakj: 151	16: Record<string, number> = { tstdwlwyh: 738, blcmijwfa: 320, wjwiunapb: 649, rnnixvbok: 424, qkolvtzzg: 418, qstvibmat: 256, lyamysavx: 140, jskroypgj: 972, qrhxhovwb: 432, gskphhhmx: 29, naybapsfp: 90, jojtgalgc: 824	17: Record<string, number> = { yeouvivlf: 377, dfsrwqzlu: 661, jpfeaxsxr: 669, erkoavbps: 937, inddmkecv: 76, vvfxbyvdh: 153, ztscrxnnd: 837, stzhfnaar: 580, shmmnvnlg: 76, dmfxkjofb: 550, tkueoysys: 699, kragfagyw: 106	18: Record<string, number> = { lqjqfldzf: 398, hpmkqdgqm: 860, lanmoercs: 869, zwrbbloms: 20, fcpxuuwhc: 186, tegyelswy: 763, ocgjqogih: 437, ncnoioexk: 422, rpvxmsxab: 329, ndtcufeff: 419, lgmicmtrz: 710, duosqlffn: 202	19: Record<string, number> = { ksojrbvlo: 273, uumlmyasb: 359, eqsgfqrla: 871, saxhopkeg: 142, lnluizvny: 580, enmlthrut: 894, nurlcwwxx: 911, mqqsxsigo: 383, etdnvlypu: 673, cjxgzzsgv: 213, ooqqponnh: 900, lxzsjgifl: 121
20: Record<string, number> = { onrnoccxj: 395, sgvpsvwgz: 357, mqednsueh: 405, svsxpiuao: 372, mkwvvkwnj: 483, oqbgpuaaw: 486, pcxgpetur: 696, cgovgtvar: 221, mtclzwndq: 415, xcxofxfhm: 36, vjkzzfska: 201, qhijoqtjg: 171	21: Record<string, number> = { ryovrxdoq: 692, hrjbgyizd: 335, haxuqvpgl: 173, tulhyaqnu: 64, bvcjcmfwj: 509, dlbpvkvnv: 186, gjowszkaf: 38, jauplmryz: 678, sgodgobuk: 949, jjhhdaqcy: 366, nfpkbeytg: 131, utvjyiniz: 639	22: Record<string, number> = { wsmruraui: 679, jvihjwkqn: 671, uleeggppw: 422, pjtpenvny: 720, puartpgcc: 237, fkwsvawek: 256, gtbmgnqhu: 520, oyeiozefy: 681, atltnfjvg: 185, kyuxlwcxi: 141, balpcnvyq: 621, caepsmuym: 603	23: Record<string, number> = { biygwfemg: 429, vcgretjzk: 466, dbbgwbzzq: 190, jdyxpqqmn: 330, imaulgvqm: 369, cpbmewjeu: 403, byupaxobp: 813, rypxvqmvu: 723, nrianpxls: 785, luzuiuntm: 888, gzeobwhdv: 80, xllcgkhzh: 885	24: Record<string, number> = { vkdlusavf: 279, besldoups: 223, sjnjiotlj: 962, eoymcgcje: 125, hkothmhai: 408, opyfegupf: 355, wmnfmsmlr: 550, koshkuall: 856, ukybrxsrn: 126, eynfvechg: 536, elttvifuo: 525, gyqdrvtul: 770
25: Record<string, number> = { awpuyybxo: 12, cmmqqajne: 1, mcrfywtge: 64, ykmuvqvtr: 327, bmhmurqlp: 986, frwztczod: 788, qezctmqbe: 700, ktpgifsfw: 870, zxtjamolb: 663, xtuffwvsd: 556, jnxktavtb: 365, tbnzgcfib: 823	26: Record<string, number> = { myaklgnur: 249, altugzvqw: 833, lpmxzdbqy: 332, imhlvsvug: 330, ccykwsole: 720, tthztclag: 822, eldpsievt: 820, udxxuszvn: 901, sgsnpkxnu: 125, vfddaziaw: 769, utxmynlqx: 270, swgkauyec: 94	27: Record<string, number> = { dzqpyfkkp: 947, hmeubivqs: 597, kmtqlgpca: 815, wmwfsfhvi: 846, cupljcqbz: 498, mleipdiqh: 52, xwclokpwb: 211, pucveersm: 0, siuexkqat: 164, osbrseqfp: 606, wlpqoxgzh: 86, tumjlzcad: 497	28: Record<string, number> = { ckywutovn: 327, wjtjaiimb: 860, hjwiemfrn: 588, olkgprvtp: 980, bqotbtcob: 273, tsqshewgr: 989, edrrmnnmi: 689, qiyaltnzf: 826, mtlxwyqbc: 471, eqdpxedkj: 760, xruaomtla: 616, oobuiuohx: 257	29: Record<string, number> = { rilrgfxmb: 854, drzdegwjy: 83, snabcuxpu: 354, uvkfjvhzs: 899, rdxrcmffv: 282, gljhougbi: 808, pqpokomas: 122, eubxuivza: 234, rcuszhvxh: 362, aupickknk: 76, kmndpaega: 732, vbjbbwdkp: 447
30: Record<string, number> = { bulvkknjn: 231, gzpqxdnjh: 331, nlizgddun: 810, hrjzhqemt: 853, dcondixxz: 909, vuwmfxrbd: 560, aonairsoq: 430, qmedrachz: 900, cunoevctz: 212, erapemynq: 156, kfmpvsxjv: 459, qzzxglhhj: 372	31: Record<string, number> = { ficxujtcd: 582, dwugwxcxa: 369, fzwjbjdin: 303, mhylxnmmv: 714, uqmxpahbr: 572, dvomzzwgw: 993, tsdcmjthi: 890, olyzevzcm: 673, hpdparowe: 494, vzwowkcdd: 94, tnfehxgut: 404, qprpfqfqd: 859	32: Record<string, number> = { pyvfxigtd: 452, zsofchxkw: 485, bkrsjnvjw: 899, zbsqluuyi: 455, wnmfstylc: 401, mgffmlqin: 544, knsphovjp: 628, tlsoowagl: 254, awczqggmv: 83, nllwnnenh: 624, ynvjcgngw: 811, ivhkgbxgk: 586	33: Record<string, number> = { acaokoqnn: 543, scjimehem: 190, ykpwsaift: 989, kbemtbfvx: 778, qyjcxhpxg: 233, zlhwvxgew: 776, lndcmmbtm: 487, witakzfqe: 260, hfcwfxkfz: 176, bzgkdvsrg: 792, fhocbyruj: 716, uivthhmtn: 203	34: Record<string, number> = { dnqtclkeb: 777, bxciuiscj: 839, sedevvwru: 360, tgccjrqcx: 31, fkbzrkbhs: 393, ezttzoymm: 746, cpmjyydzs: 651, pbyfbaqhj: 492, ogaglfass: 811, qiafuvdua: 175, ynnejphjv: 464, zpttauqvz: 485
35: Record<string, number> = { vldicvged: 730, wsjheoklm: 650, dhhqhihwc: 793, kswztfsjn: 395, hcuxirjxk: 414, oflbyqaqe: 589, wnqpwgqhx: 746, dbrhrukso: 184, vgkucwbgq: 728, rjtjitxpj: 333, noehscecc: 521, axrveekyi: 845	36: Record<string, number> = { bbjhgxqpg: 137, wuqvuozqv: 573, qasfutejy: 566, gmasijblo: 532, dwryfdgoj: 789, gimskgxkz: 361, kufiyndpo: 503, wbffiehnw: 191, czrhtievj: 666, ygdkzraav: 527, atdudgnfx: 878, lcyoabcgr: 418	37: Record<string, number> = { piwethbap: 68, eckebbmfb: 693, xcspyizno: 388, uosdfiiwd: 146, wfzkqnneg: 811, kucbodhes: 677, rroqgchmr: 527, swjhswrnc: 453, nlttddbjl: 24, xooifsjqa: 734, xlglxxcxr: 374, ympcslnti: 148	38: Record<string, number> = { mswmdrlkj: 396, szplbrdgo: 101, tscmmvqsx: 647, uctvahtlo: 656, lzwvzwpfn: 246, kilytioxw: 889, fdmvscjhf: 770, dumxejsft: 980, wrjnmbvvv: 629, qpcxlhbfs: 858, svwutleen: 943, wiwtupwpw: 639	39: Record<string, number> = { ulehzvsib: 925, wguekywss: 109, sbvfrvcbk: 197, qgreilgwn: 66, qmlxytans: 142, pvjfxvhfk: 715, cyeiomnbd: 284, jfwepzcwi: 332, epacjyfkc: 310, aelmszwvl: 547, hoxubdhdn: 584, tpzwtkqfr: 188
40: Record<string, number> = { snlykxcok: 209, smkyfznhv: 977, uqhqjlrlb: 999, bsedxalql: 637, wthoonqgn: 918, amjybfxhb: 184, zgcltokio: 479, oyskhripa: 734, ikinxadem: 629, fyjrmyoeq: 146, vgmcquaar: 912, bvyzksenv: 415	41: Record<string, number> = { iyjhlhpvt: 137, fakvvhfmu: 639, qginnvdun: 10, ivyttfdik: 951, oaluiqvsi: 276, syouuphba: 392, edcevxxyc: 840, nziyepaya: 763, dfqujxoel: 273, wfytwzzid: 981, lgppttmhg: 653, pjsqucrrh: 411	42: Record<string, number> = { qnaszlsek: 624, dyoduhbcq: 432, xbriawwxz: 779, ypbbqvzjh: 525, galqimuad: 617, vdidtvltt: 66, etbasvwjm: 691, bojrvakbk: 517, qunovcnat: 930, osottxoas: 508, qxrdcmszf: 711, xrponlzwf: 120	43: Record<string, number> = { qgwsaugpt: 578, jdtjfshqj: 996, nygdhzwus: 287, obuesiwku: 844, wsowsapgf: 334, egxcjcxgh: 969, aszkuwiya: 830, faghmkrej: 528, wttxltpjx: 47, hgpkazyha: 307, ziolazdac: 316, aehrcpyxn: 951	44: Record<string, number> = { pcsnbdais: 970, yehebakia: 575, ckhpchcsl: 364, klhrkgwoc: 267, yiloowgen: 603, wiiolaixq: 191, nmgdtxbab: 774, jrfjqozjr: 437, wetbcaslh: 208, cywlrhlln: 640, rvyizwgwk: 324, bdtfutsmn: 268
45: Record<string, number> = { lsapsebrt: 393, icupznqoj: 562, vyluirjyi: 637, yvozmgngg: 730, jlzhdtfbu: 961, jtuazepqj: 660, rvopqwbjh: 591, tkwlhlbjm: 281, tcyglbbgx: 701, fmqfxzzkc: 76, nlwxsnxrl: 650, gqgfcdftu: 184	46: Record<string, number> = { ddpuxxzma: 64, lhvofrpuu: 832, ebqmobajf: 38, erwvouaqs: 956, naxjuswnt: 565, eonyirbwa: 875, cwqkcjheo: 0, gfpupqfff: 498, zgvpywotn: 617, tmndrmfgp: 535, kvrcbwmip: 670, wrycbxpgv: 216	47: Record<string, number> = { ihkculuev: 235, iwacatchb: 566, azrxhwqkq: 755, xblygwjyj: 787, daodnadlc: 157, alzmwdklf: 694, afzxnbbra: 675, mortmpdfn: 953, nyvfxfvnd: 310, jrktecrwe: 596, uigwzoikp: 326, vrqaahmsb: 212	48: Record<string, number> = { vedbwacqm: 804, grsugtmsn: 519, twllmvvdo: 486, mitrkagep: 62, auvxuzxof: 360, sbhurgywp: 729, uhulsdvuy: 646, npylanyyq: 190, wnuepgohl: 399, yydybztux: 17, cymvhzfeh: 578, jfatzxmpx: 219	49: Record<string, number> = { wuvtrqbio: 995, hepkrlign: 37, kgcswhtqi: 478, uqkqfiude: 411, woqtklrqx: 538, rtfikspzq: 122, mmbjofxzt: 636, ydlcoeekm: 709, bhwkrnjvw: 811, tuvlqrrpf: 804, cgimbsdor: 504, onlvjivpe: 497
50: Record<string, number> = { gtywcezra: 991, eltyapnlj: 592, akehibiqh: 363, wmxumvemn: 918, iewnjalsr: 980, pnqcajfuk: 507, ptsqworhz: 292, cvhdwaawf: 977, ncfhyutaa: 739, mobtexchi: 560, dexoxcehq: 208, ggbmhstkd: 305	51: Record<string, number> = { ghsevapvy: 251, tncjdapch: 515, rikttielm: 512, hkayfklav: 892, vmbzrielj: 984, iugxoftpp: 808, zxwbbcrql: 619, hnajslolx: 677, noguuxinp: 499, qpwmnuhhw: 635, brmeliyuf: 425, piklpdcoh: 161	52: Record<string, number> = { svdhyogpp: 827, qzpbverpi: 418, xbasipzfz: 739, zhdgsjlqk: 287, gmhumaikr: 67, rwagobfij: 787, asqtbevsz: 188, zgzpnwtwj: 112, wnueccime: 855, swnwgjple: 275, zvekeklwa: 319, ysmmuvyas: 45	53: Record<string, number> = { eblcomccg: 338, yqwerzkwg: 922, jwfgqioff: 410, oqtrxypqq: 687, xomldshyi: 11, oixqdzfgd: 68, mapyqgpck: 501, facnqwhhh: 26, gtqtxiwgm: 191, nlrbanmgb: 175, hnxpayfjs: 999, vfvadalzk: 801	54: Record<string, number> = { elnlkalem: 203, pdzgbcfoj: 523, pbcwvuvpx: 263, pruhgdojz: 660, ydrvmoelo: 386, ccbxfnhwq: 59, tijfrldex: 708, ryyiussub: 854, pcuzilvyy: 783, zenmjvhif: 301, wueyvyiwm: 489, oivstlmvm: 400
55: Record<string, number> = { gzlyyxsvr: 260, fevfpzaji: 751, vvnlbwwas: 124, xumnatwnh: 854, gblvpukrs: 977, utdxzywvk: 820, vdlknfdor: 55, gwbuxrfmh: 810, ccidaqshc: 727, cubosdlva: 874, lufegnjxb: 78, vjbagjmdk: 496	56: Record<string, number> = { xphkyesyf: 655, jktgzcjqm: 627, tcukzkdno: 890, ucrismyyo: 848, uwnzaqtbs: 904, iutgrumgi: 911, gohjhdfio: 642, oasavdujm: 754, fnjcsfhef: 97, cokyelplc: 342, sqtuqsqaw: 833, kgcjzwqpy: 661	57: Record<string, number> = { yyibzyplm: 580, dpgrsszgj: 71, wbozorevq: 702, fkjhcnvzn: 556, ipabqahid: 948, tefwembks: 186, casuumriv: 312, yzcjsecoy: 159, kzywlwjob: 375, elzexefml: 895, zmoexpaew: 647, rckfwdquc: 824	58: Record<string, number> = { tmjfwgvbk: 91, oasisfrxo: 693, tlptniilh: 542, anebhachy: 107, rlqbpkjdk: 652, jepqthdjg: 257, jnfpkrakn: 682, tzksfxotl: 98, inaxxqedk: 425, hqocoanff: 557, vlvijhxpd: 274, mdmguvcqs: 636	59: Record<string, number> = { ztxlhlyul: 412, ijcqprrof: 711, iqbrliwbq: 861, wjbjaszdh: 600, cenydazqv: 314, ymgehqzcg: 540, cxbscthcu: 398, xbbersvcu: 187, zufqstiiu: 600, gdhotfrbs: 673, ijunipltw: 300, nuzqjipbg: 189
60: Record<string, number> = { bhxtinplj: 183, eqhdghtqv: 308, fosocsyjs: 258, urlxlbzay: 221, hprbawmkh: 480, fcymwesgh: 392, yazvwreub: 646, nebvhyzbb: 805, vntywpuqe: 282, xmibserks: 511, xaudkxgnx: 797, ojyteyegu: 95	61: Record<string, number> = { myjywfipd: 518, rohcmzpny: 470, ytlsmcfjm: 942, zvltlemzj: 383, bfsjlaqli: 829, uvasvjltx: 47, tkgcdspup: 886, bsyddcwob: 848, gqordrswk: 598, svwcbulhe: 533, seqecwgxs: 148, txqfxzrrr: 855	62: Record<string, number> = { qibeabfyl: 493, zdihjlrdx: 908, ttiieipeo: 544, rbhhsxvrf: 145, hhcyaiscc: 147, zmadqahfc: 806, xjzfwuogu: 761, tdvrknhah: 820, cfpqndaxj: 351, ygchshojv: 355, cuymgoiuy: 997, prykpptxn: 847	63: Record<string, number> = { pjnsaqewj: 509, upxgmxetl: 345, xzizrsqtf: 58, kprxheyto: 374, ebxjghqsb: 418, vgiocnvpu: 366, cyecueude: 433, iyukbbzfe: 656, vnkwujrma: 707, skmcozagl: 672, vxhkjxwbb: 577, erhuialtj: 445	64: Record<string, number> = { ttiuggedd: 611, rvniafhli: 816, ksmoxuqwg: 749, kzonheauq: 956, dgmfdqscs: 119, eemgdkxfs: 956, dpplrzewi: 863, lahrhsekp: 378, keyjfpkxg: 390, minexixzy: 854, euobkbsag: 893, gbjykxxhh: 115
65: Record<string, number> = { nbckboxbp: 819, rollsmcmu: 40, jdztfmbue: 723, nbsrlnote: 747, xtntbftem: 256, cysgywjqx: 290, mzcqavvar: 457, xtrywwyep: 253, bkahqtrta: 617, vqhiletgj: 862, jilykbzbw: 692, xpesltcbq: 273	66: Record<string, number> = { jeoyyanoa: 797, vutxoudnv: 994, xvhtfuqel: 206, aenvndgku: 589, areorywkb: 817, rpwdsmukm: 37, cgosrlztg: 840, ufchrjxmx: 139, zuudunqxm: 456, rfqoszdhg: 53, stxfyfoyq: 767, nnuhjodzs: 595	67: Record<string, number> = { gkcuqathy: 780, ztqhhfrmc: 839, ofcikwvvz: 756, qddijypay: 355, wwlzvydfu: 202, niabqotxf: 263, dgghndbas: 880, ocgirgltn: 865, eigtqmlhv: 21, anqkvvibg: 645, ytqaazwrd: 762, tqnhtjeuv: 745	68: Record<string, number> = { ldimgkgnf: 872, ewphtmdby: 655, easkuniks: 77, eyrzlkdhx: 158, fsazjvtgx: 83, jscgumdbo: 903, ternkjvbx: 272, eovsvrjoj: 783, gkkhkfdno: 225, pttemnksj: 480, baajkcpxv: 630, oyfmknzik: 872	69: Record<string, number> = { affxlgaew: 181, stumwxawt: 758, fnfpyzzmb: 973, tggfexpky: 969, clkipobdc: 931, luybegxgh: 750, iqketjked: 450, mbcrdmiem: 497, qohumbtgh: 755, atbythgjk: 86, ufufchseo: 333, nlzqatmaq: 604
70: Record<string, number> = { gehfijbhp: 639, kjsyvhwtf: 313, hyiquusza: 434, unqpoudzl: 479, oojzydnzt: 790, apbkbajvx: 142, sdamcheye: 77, zsyjsjmsj: 324, rvkeyuqsx: 863, qaceougfs: 34, zsgyykqyl: 703, ikyuucqwm: 734	71: Record<string, number> = { sawcyqbzp: 393, gocvlxzal: 920, fvnslfvkd: 283, hjjacuczp: 768, taojpppts: 261, jejqthnam: 177, nmuzcoyev: 489, sectknjwm: 247, czvztxjsp: 970, vlnjyccqe: 819, gnupzbfir: 355, xryjnixia: 865	72: Record<string, number> = { cgmxmqfee: 439, hsirtriqc: 413, vixibnoir: 948, zhmeopvst: 460, ndxrayira: 971, dhguyopdj: 709, wtsuimmou: 59, iethugqkt: 718, hdmkkudyu: 156, oeaogynkn: 381, gykpvqimq: 355, fsjkozoho: 211	73: Record<string, number> = { imwsuxpca: 809, bvczwokoz: 15, eflnmtqnn: 948, qrujvlhmf: 776, eicgevcku: 933, dcflfcsjt: 513, sfawfmdmq: 737, iwlubrbut: 169, uetbgvjts: 856, iamqdezfl: 890, fniryhogf: 454, uxunxjvxz: 11	74: Record<string, number> = { dfaucfnot: 111, qgeyecdcf: 467, ehrxdenpt: 75, nrulbrgxy: 450, lykhmwvic: 730, icwhulcft: 278, ngtjuwjrg: 735, osdydckqu: 473, jeeyvykhu: 175, cgfqrvtdy: 106, zmydclydo: 995, wccavpkor: 17
75: Record<string, number> = { acmsnjhjg: 163, wsmqxhmyj: 549, lrlsnodyd: 816, xfpyddfsw: 359, zgrnrponi: 827, rlfoaamfy: 770, ejqsjgohg: 312, zbnkfvuzy: 457, mqfmgbbfq: 982, nwozmkwux: 945, emcrdnafo: 348, lhbazmvyc: 958	76: Record<string, number> = { rdeaxzfau: 555, ugpdjxsbq: 208, fikeweoxw: 272, rfefesmfq: 675, fbolkvjhd: 178, kjjuevvmh: 800, owfhlsfkb: 477, gjegceodj: 61, ooxczinmr: 556, nbgadcsum: 23, mengysfty: 328, szxeglivx: 754	77: Record<string, number> = { iqqwhuccn: 863, nuuwafrjj: 483, qefcyhnri: 904, fwkmhodaf: 213, nnuzpwvcb: 729, lalsniyde: 216, xllfmnpou: 956, nbbcpcxmg: 839, joevwpvun: 1, gpnjspdih: 382, jqhszhptj: 787, hgdxuiqbc: 749	78: Record<string, number> = { qtqqqbqun: 837, lxwxrxeri: 268, pcpemwtwr: 733, ubmibeilt: 853, huttjmqkb: 0, nndahlftm: 680, ljoffrtry: 329, ehgffdsnp: 956, bkdwtcues: 234, lyexudmqa: 398, bythmruwk: 845, equodugkq: 959	79: Record<string, number> = { timcdedar: 692, aakljrdbk: 641, rymxhgubg: 189, qodgjrtwx: 721, colhnmrhi: 815, izcorlqyk: 782, toiesecan: 275, eqirstrrk: 346, tpiilnpni: 271, hqucrfcrh: 422, bejpjoorp: 550, cvrquhdde: 357
80: Record<string, number> = { abjvexgtd: 912, itontaqpl: 830, orpzgsigr: 18, yhshseqvd: 532, mapcdmqrb: 978, fxagobfxs: 344, koyrvzbyt: 507, apfxvsdwu: 527, nvgutmvru: 987, nhodlzihk: 723, hxkjcxymt: 896, pvzetlyud: 933	81: Record<string, number> = { pxzekygbp: 378, mxishszrb: 549, eahxbvpxi: 277, isjnaqnky: 171, ujxpznosr: 613, lfvhgychq: 924, fdlxwmfqo: 810, jocdbstrm: 648, llcllobfd: 573, azhvbmcfd: 972, zytvxxgvz: 146, qrnkyhhnp: 707	82: Record<string, number> = { zlrqyhcdl: 380, vttgwrwzn: 359, kuwanwhkh: 932, ruhtkdokv: 510, uyxdzmbug: 421, swpkrvixo: 961, pxerdkxkg: 448, adxxzbejr: 840, phoawnhji: 820, ogbyimfux: 689, wxwgfagah: 53, gxovgtwpk: 625	83: Record<string, number> = { pukjyjeoy: 811, tgtxnasne: 961, nihebyqat: 158, krbuoywvj: 512, xprsrmadd: 320, fdxauynan: 132, jzlxlyurp: 808, xtdmktwbg: 379, ievnuugit: 736, elhqjmqbg: 60, bzbpmbaqm: 614, xmtplhwme: 57	84: Record<string, number> = { bsanujezb: 901, tivwkzxcy: 492, tecbvfhrr: 943, eeawvtmlo: 432, vxoscmwag: 429, dxixabkro: 65, mybubpiaa: 176, kxzdxficj: 752, pjepnwmqr: 474, krzwnvvpo: 99, eaugbefbi: 649, emxlmdlvw: 967
85: Record<string, number> = { vlqigvgic: 79, lbzzijvee: 765, ivhoksvwx: 320, xoisqekje: 310, ulujqonau: 247, zdhfspcux: 901, qqwwewjml: 572, vehbvbneo: 350, vdavpityp: 872, hnzzowldv: 189, leijycwbt: 566, olbdgaxmo: 197	86: Record<string, number> = { vrmxojumc: 893, fuffuppcf: 82, pwskjiklp: 816, iachlrngv: 747, nnceakjxm: 884, smddnavja: 681, ihrfkuhny: 434, vrqqmfmiz: 652, vitopqufw: 510, wardxiozd: 126, nfwjbcfrp: 713, fxxymzhll: 174	87: Record<string, number> = { xozduycfq: 877, dfwddcdiy: 585, ycubucaam: 730, gftnsirqh: 753, osfejjqqs: 11, veweiucje: 658, kbsadqvpz: 375, zkddykmvn: 562, chbrlvrqd: 471, gvysabyqn: 838, wdgkwhivu: 152, qbhicezmi: 562	88: Record<string, number> = { mrgdwgopa: 391, keaxeitab: 657, thguczqag: 725, xhqnvdvxj: 778, sqwzwgwdt: 17, yfnxldhnd: 919, wjlhpqevn: 344, ovlutbgtt: 119, cpjkljeuu: 49, cuddqszrk: 772, awrsgfyhu: 105, gjzecmxdk: 616	89: Record<string, number> = { ygbukvvyd: 349, nlvcvuvpj: 695, niqoznzxa: 812, lxwogdydb: 866, qvyvxnvis: 64, nkqvnczsd: 756, dmtmfzmtb: 29, tgsappamp: 479, ezvawupde: 776, nbyagfueq: 918, xcuwoyvsn: 247, yhsyyrwyb: 913
90: Record<string, number> = { vtsxkbykr: 892, xegdgfpte: 223, ljsfptpva: 335, bnbamnddt: 992, ufyjqbkdo: 981, znyogzbjj: 324, qwqppomye: 156, bfjfgahmh: 883, qdfqspvpa: 871, pqqiubhcx: 519, eeersqnmu: 411, llpcggewl: 554	91: Record<string, number> = { cnntrhtsl: 157, aaybmjsta: 70, wvacigeka: 38, mnugiunxt: 316, osvchyxqn: 369, grwxxxken: 311, sztzroucv: 636, jtbvnlvrh: 123, ocobanqev: 832, blqpmdjhx: 532, ingqoibfl: 826, imhnftcoo: 734	92: Record<string, number> = { whnouiado: 239, ruzjvdayq: 407, ajxuwakpv: 608, ejfoczuze: 909, xuigypfky: 425, jadvftdyb: 743, pqhbktrzn: 838, kdolwatik: 229, eccadhwnq: 665, mecaovjyt: 412, tbcxuzpmq: 239, hxtjrgzdw: 475	93: Record<string, number> = { xergmalgb: 198, ztcyyczrz: 320, wvblotxwr: 826, lpewzmgfd: 499, fvyemgwyv: 105, vnxbsskbx: 464, fsdvvrons: 573, iofbgwnms: 287, jttekeegx: 386, notpkigwc: 171, tnyisihqs: 380, guqbusasm: 293	94: Record<string, number> = { bnltptbps: 183, pcyveqrti: 427, mbpxombwb: 15, gtqlcklpq: 253, sdlcsohyr: 642, lfntifiex: 678, udwgazepb: 169, zcslogusn: 559, skisbqfll: 489, swfidohet: 952, ibfgbznbj: 128, zjkquyfnx: 233
95: Record<string, number> = { niyjalwtf: 26, ngrghkwza: 893, wygsfztwx: 131, aqhrnifpg: 91, ipzhoizet: 623, iiivcmfrw: 776, zjtyncsnb: 206, czqqvrrwq: 844, jilxnbsov: 197, zhxcdrldl: 241, dpfinutqh: 958, aubjssjqm: 598	96: Record<string, number> = { kaukdvvlu: 87, icblxoptq: 931, ndcqqqigk: 906, fqiczspal: 134, zdtpzamqz: 402, foifhahbk: 499, hkyfzgnqw: 840, gamuegunw: 589, qvtkiiyww: 70, blskngfzy: 950, uyusgnnnc: 264, qtzwmrlnt: 120	97: Record<string, number> = { gdvqvzntr: 60, agofyzlmh: 650, bflzsxbzg: 249, bncixwxir: 122, rdcdungov: 130, nrituvmnq: 60, vsdlylwlp: 775, qkytidpjx: 316, kwzvcmfkv: 961, bkrksbkye: 713, ajafybcgh: 518, ntbcrkztb: 264	98: Record<string, number> = { jrtcdefld: 833, crtmxfduy: 719, lufggbjxe: 254, oeslsdtbb: 420, lnxwhwfrf: 587, yygumjeqc: 871, uhdyyxmer: 342, xiuqcbgtn: 638, yifavrnnb: 702, ulvmkrswk: 713, ufjxrgcvp: 219, vynbbhirg: 825	99: Record<string, number> = { lgwktnier: 326, rjllgiyqn: 29, fqqjgfmbw: 858, yaexfgkmf: 536, uqdxjvnoq: 238, gvcjjdfxh: 711, ozjksplxm: 107, xdqpuyshp: 805, tpudyulow: 46, ftdnworqs: 292, qkrxjeoin: 339, dfhjkyoal: 653`,
        (n, a, b, c, d, e) => `  const t${a} };
  all.push(t${5 * n});
  const t${b} };
  all.push(t${5 * n + 1});
  const t${c} };
  all.push(t${5 * n + 2});
  const t${d} };
  all.push(t${5 * n + 3});
  const t${e} };
  all.push(t${5 * n + 4});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    "lists-of-constants/tables-small-s12-same.ts": text(
      `// Lists of constants: tables small  same. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { ynujfntb: 582, qhmalpmt: 309, zogugazx: 241, nxevqauj: 716, xxclpdzt: 535, duoonecw: 918, htueblkp: 506, szhsfzjp: 999, yaimvzzx: 885, ywuzreuk: 967, cmkjvjyh: 166, telpnfnh: 23	1: Record<string, number> = { ynujfntb: 904, qhmalpmt: 734, zogugazx: 855, nxevqauj: 730, xxclpdzt: 382, duoonecw: 524, htueblkp: 398, szhsfzjp: 102, yaimvzzx: 722, ywuzreuk: 325, cmkjvjyh: 21, telpnfnh: 110	2: Record<string, number> = { ynujfntb: 146, qhmalpmt: 330, zogugazx: 472, nxevqauj: 52, xxclpdzt: 578, duoonecw: 228, htueblkp: 718, szhsfzjp: 293, yaimvzzx: 620, ywuzreuk: 977, cmkjvjyh: 712, telpnfnh: 604	3: Record<string, number> = { ynujfntb: 718, qhmalpmt: 972, zogugazx: 179, nxevqauj: 966, xxclpdzt: 502, duoonecw: 619, htueblkp: 967, szhsfzjp: 269, yaimvzzx: 35, ywuzreuk: 968, cmkjvjyh: 824, telpnfnh: 351	4: Record<string, number> = { ynujfntb: 388, qhmalpmt: 847, zogugazx: 5, nxevqauj: 622, xxclpdzt: 529, duoonecw: 582, htueblkp: 200, szhsfzjp: 677, yaimvzzx: 84, ywuzreuk: 818, cmkjvjyh: 361, telpnfnh: 149
5: Record<string, number> = { ynujfntb: 632, qhmalpmt: 272, zogugazx: 543, nxevqauj: 339, xxclpdzt: 53, duoonecw: 863, htueblkp: 887, szhsfzjp: 119, yaimvzzx: 978, ywuzreuk: 857, cmkjvjyh: 764, telpnfnh: 859	6: Record<string, number> = { ynujfntb: 301, qhmalpmt: 679, zogugazx: 212, nxevqauj: 256, xxclpdzt: 125, duoonecw: 589, htueblkp: 190, szhsfzjp: 492, yaimvzzx: 69, ywuzreuk: 831, cmkjvjyh: 878, telpnfnh: 659	7: Record<string, number> = { ynujfntb: 854, qhmalpmt: 972, zogugazx: 381, nxevqauj: 614, xxclpdzt: 260, duoonecw: 438, htueblkp: 113, szhsfzjp: 370, yaimvzzx: 997, ywuzreuk: 237, cmkjvjyh: 792, telpnfnh: 819	8: Record<string, number> = { ynujfntb: 154, qhmalpmt: 565, zogugazx: 272, nxevqauj: 469, xxclpdzt: 0, duoonecw: 330, htueblkp: 456, szhsfzjp: 298, yaimvzzx: 187, ywuzreuk: 88, cmkjvjyh: 84, telpnfnh: 59	9: Record<string, number> = { ynujfntb: 405, qhmalpmt: 619, zogugazx: 315, nxevqauj: 272, xxclpdzt: 573, duoonecw: 475, htueblkp: 918, szhsfzjp: 610, yaimvzzx: 346, ywuzreuk: 578, cmkjvjyh: 246, telpnfnh: 620
10: Record<string, number> = { ynujfntb: 863, qhmalpmt: 858, zogugazx: 342, nxevqauj: 322, xxclpdzt: 25, duoonecw: 944, htueblkp: 841, szhsfzjp: 754, yaimvzzx: 28, ywuzreuk: 71, cmkjvjyh: 854, telpnfnh: 936	11: Record<string, number> = { ynujfntb: 470, qhmalpmt: 26, zogugazx: 379, nxevqauj: 844, xxclpdzt: 724, duoonecw: 809, htueblkp: 633, szhsfzjp: 74, yaimvzzx: 230, ywuzreuk: 395, cmkjvjyh: 74, telpnfnh: 723	12: Record<string, number> = { ynujfntb: 457, qhmalpmt: 85, zogugazx: 193, nxevqauj: 106, xxclpdzt: 267, duoonecw: 128, htueblkp: 525, szhsfzjp: 303, yaimvzzx: 483, ywuzreuk: 948, cmkjvjyh: 822, telpnfnh: 767	13: Record<string, number> = { ynujfntb: 893, qhmalpmt: 829, zogugazx: 495, nxevqauj: 120, xxclpdzt: 502, duoonecw: 919, htueblkp: 11, szhsfzjp: 922, yaimvzzx: 308, ywuzreuk: 345, cmkjvjyh: 582, telpnfnh: 930	14: Record<string, number> = { ynujfntb: 567, qhmalpmt: 713, zogugazx: 528, nxevqauj: 266, xxclpdzt: 328, duoonecw: 925, htueblkp: 445, szhsfzjp: 915, yaimvzzx: 822, ywuzreuk: 80, cmkjvjyh: 463, telpnfnh: 147
15: Record<string, number> = { ynujfntb: 578, qhmalpmt: 158, zogugazx: 887, nxevqauj: 253, xxclpdzt: 314, duoonecw: 419, htueblkp: 795, szhsfzjp: 517, yaimvzzx: 438, ywuzreuk: 766, cmkjvjyh: 94, telpnfnh: 375	16: Record<string, number> = { ynujfntb: 432, qhmalpmt: 227, zogugazx: 131, nxevqauj: 347, xxclpdzt: 251, duoonecw: 695, htueblkp: 238, szhsfzjp: 527, yaimvzzx: 197, ywuzreuk: 468, cmkjvjyh: 874, telpnfnh: 889	17: Record<string, number> = { ynujfntb: 308, qhmalpmt: 144, zogugazx: 98, nxevqauj: 272, xxclpdzt: 430, duoonecw: 258, htueblkp: 725, szhsfzjp: 818, yaimvzzx: 169, ywuzreuk: 380, cmkjvjyh: 419, telpnfnh: 276	18: Record<string, number> = { ynujfntb: 201, qhmalpmt: 528, zogugazx: 761, nxevqauj: 924, xxclpdzt: 626, duoonecw: 776, htueblkp: 980, szhsfzjp: 983, yaimvzzx: 116, ywuzreuk: 347, cmkjvjyh: 311, telpnfnh: 736	19: Record<string, number> = { ynujfntb: 351, qhmalpmt: 933, zogugazx: 651, nxevqauj: 404, xxclpdzt: 552, duoonecw: 385, htueblkp: 10, szhsfzjp: 651, yaimvzzx: 508, ywuzreuk: 706, cmkjvjyh: 419, telpnfnh: 460
20: Record<string, number> = { ynujfntb: 427, qhmalpmt: 952, zogugazx: 670, nxevqauj: 316, xxclpdzt: 921, duoonecw: 261, htueblkp: 4, szhsfzjp: 140, yaimvzzx: 534, ywuzreuk: 812, cmkjvjyh: 305, telpnfnh: 274	21: Record<string, number> = { ynujfntb: 723, qhmalpmt: 642, zogugazx: 400, nxevqauj: 160, xxclpdzt: 221, duoonecw: 433, htueblkp: 318, szhsfzjp: 74, yaimvzzx: 585, ywuzreuk: 8, cmkjvjyh: 803, telpnfnh: 320	22: Record<string, number> = { ynujfntb: 651, qhmalpmt: 366, zogugazx: 800, nxevqauj: 678, xxclpdzt: 328, duoonecw: 192, htueblkp: 223, szhsfzjp: 652, yaimvzzx: 989, ywuzreuk: 702, cmkjvjyh: 476, telpnfnh: 799	23: Record<string, number> = { ynujfntb: 827, qhmalpmt: 773, zogugazx: 485, nxevqauj: 53, xxclpdzt: 241, duoonecw: 303, htueblkp: 910, szhsfzjp: 750, yaimvzzx: 255, ywuzreuk: 834, cmkjvjyh: 597, telpnfnh: 167	24: Record<string, number> = { ynujfntb: 262, qhmalpmt: 204, zogugazx: 593, nxevqauj: 99, xxclpdzt: 449, duoonecw: 9, htueblkp: 529, szhsfzjp: 216, yaimvzzx: 177, ywuzreuk: 504, cmkjvjyh: 704, telpnfnh: 3
25: Record<string, number> = { ynujfntb: 626, qhmalpmt: 178, zogugazx: 412, nxevqauj: 901, xxclpdzt: 463, duoonecw: 535, htueblkp: 456, szhsfzjp: 228, yaimvzzx: 774, ywuzreuk: 551, cmkjvjyh: 300, telpnfnh: 162	26: Record<string, number> = { ynujfntb: 780, qhmalpmt: 995, zogugazx: 987, nxevqauj: 810, xxclpdzt: 102, duoonecw: 794, htueblkp: 101, szhsfzjp: 610, yaimvzzx: 928, ywuzreuk: 874, cmkjvjyh: 255, telpnfnh: 960	27: Record<string, number> = { ynujfntb: 244, qhmalpmt: 394, zogugazx: 502, nxevqauj: 786, xxclpdzt: 406, duoonecw: 293, htueblkp: 333, szhsfzjp: 546, yaimvzzx: 0, ywuzreuk: 633, cmkjvjyh: 512, telpnfnh: 618	28: Record<string, number> = { ynujfntb: 960, qhmalpmt: 737, zogugazx: 20, nxevqauj: 482, xxclpdzt: 295, duoonecw: 436, htueblkp: 89, szhsfzjp: 49, yaimvzzx: 616, ywuzreuk: 469, cmkjvjyh: 532, telpnfnh: 329	29: Record<string, number> = { ynujfntb: 887, qhmalpmt: 662, zogugazx: 759, nxevqauj: 732, xxclpdzt: 551, duoonecw: 119, htueblkp: 436, szhsfzjp: 399, yaimvzzx: 919, ywuzreuk: 649, cmkjvjyh: 268, telpnfnh: 589
30: Record<string, number> = { ynujfntb: 488, qhmalpmt: 743, zogugazx: 394, nxevqauj: 804, xxclpdzt: 668, duoonecw: 472, htueblkp: 912, szhsfzjp: 898, yaimvzzx: 724, ywuzreuk: 732, cmkjvjyh: 806, telpnfnh: 784	31: Record<string, number> = { ynujfntb: 189, qhmalpmt: 454, zogugazx: 857, nxevqauj: 426, xxclpdzt: 574, duoonecw: 740, htueblkp: 838, szhsfzjp: 989, yaimvzzx: 689, ywuzreuk: 806, cmkjvjyh: 103, telpnfnh: 882	32: Record<string, number> = { ynujfntb: 272, qhmalpmt: 258, zogugazx: 823, nxevqauj: 553, xxclpdzt: 569, duoonecw: 509, htueblkp: 182, szhsfzjp: 269, yaimvzzx: 124, ywuzreuk: 597, cmkjvjyh: 21, telpnfnh: 689	33: Record<string, number> = { ynujfntb: 360, qhmalpmt: 366, zogugazx: 177, nxevqauj: 158, xxclpdzt: 558, duoonecw: 677, htueblkp: 501, szhsfzjp: 949, yaimvzzx: 474, ywuzreuk: 116, cmkjvjyh: 24, telpnfnh: 869	34: Record<string, number> = { ynujfntb: 862, qhmalpmt: 580, zogugazx: 341, nxevqauj: 583, xxclpdzt: 627, duoonecw: 673, htueblkp: 504, szhsfzjp: 388, yaimvzzx: 282, ywuzreuk: 524, cmkjvjyh: 633, telpnfnh: 404
35: Record<string, number> = { ynujfntb: 16, qhmalpmt: 549, zogugazx: 558, nxevqauj: 956, xxclpdzt: 343, duoonecw: 372, htueblkp: 412, szhsfzjp: 483, yaimvzzx: 163, ywuzreuk: 313, cmkjvjyh: 102, telpnfnh: 30	36: Record<string, number> = { ynujfntb: 519, qhmalpmt: 996, zogugazx: 421, nxevqauj: 162, xxclpdzt: 64, duoonecw: 56, htueblkp: 825, szhsfzjp: 106, yaimvzzx: 462, ywuzreuk: 759, cmkjvjyh: 513, telpnfnh: 957	37: Record<string, number> = { ynujfntb: 51, qhmalpmt: 494, zogugazx: 101, nxevqauj: 936, xxclpdzt: 271, duoonecw: 898, htueblkp: 862, szhsfzjp: 28, yaimvzzx: 554, ywuzreuk: 792, cmkjvjyh: 124, telpnfnh: 518	38: Record<string, number> = { ynujfntb: 275, qhmalpmt: 435, zogugazx: 699, nxevqauj: 890, xxclpdzt: 383, duoonecw: 889, htueblkp: 480, szhsfzjp: 868, yaimvzzx: 628, ywuzreuk: 925, cmkjvjyh: 631, telpnfnh: 342	39: Record<string, number> = { ynujfntb: 810, qhmalpmt: 359, zogugazx: 64, nxevqauj: 688, xxclpdzt: 235, duoonecw: 589, htueblkp: 402, szhsfzjp: 414, yaimvzzx: 112, ywuzreuk: 186, cmkjvjyh: 993, telpnfnh: 159
40: Record<string, number> = { ynujfntb: 655, qhmalpmt: 261, zogugazx: 8, nxevqauj: 344, xxclpdzt: 175, duoonecw: 643, htueblkp: 472, szhsfzjp: 315, yaimvzzx: 668, ywuzreuk: 410, cmkjvjyh: 432, telpnfnh: 691	41: Record<string, number> = { ynujfntb: 808, qhmalpmt: 724, zogugazx: 648, nxevqauj: 662, xxclpdzt: 394, duoonecw: 247, htueblkp: 261, szhsfzjp: 190, yaimvzzx: 204, ywuzreuk: 111, cmkjvjyh: 810, telpnfnh: 481	42: Record<string, number> = { ynujfntb: 749, qhmalpmt: 683, zogugazx: 305, nxevqauj: 818, xxclpdzt: 241, duoonecw: 813, htueblkp: 586, szhsfzjp: 822, yaimvzzx: 934, ywuzreuk: 936, cmkjvjyh: 992, telpnfnh: 649	43: Record<string, number> = { ynujfntb: 287, qhmalpmt: 355, zogugazx: 574, nxevqauj: 206, xxclpdzt: 385, duoonecw: 792, htueblkp: 888, szhsfzjp: 147, yaimvzzx: 744, ywuzreuk: 469, cmkjvjyh: 93, telpnfnh: 453	44: Record<string, number> = { ynujfntb: 945, qhmalpmt: 57, zogugazx: 505, nxevqauj: 60, xxclpdzt: 955, duoonecw: 94, htueblkp: 953, szhsfzjp: 643, yaimvzzx: 166, ywuzreuk: 175, cmkjvjyh: 829, telpnfnh: 357
45: Record<string, number> = { ynujfntb: 988, qhmalpmt: 387, zogugazx: 578, nxevqauj: 679, xxclpdzt: 689, duoonecw: 920, htueblkp: 462, szhsfzjp: 158, yaimvzzx: 395, ywuzreuk: 562, cmkjvjyh: 663, telpnfnh: 473	46: Record<string, number> = { ynujfntb: 405, qhmalpmt: 611, zogugazx: 423, nxevqauj: 658, xxclpdzt: 96, duoonecw: 224, htueblkp: 890, szhsfzjp: 658, yaimvzzx: 130, ywuzreuk: 988, cmkjvjyh: 260, telpnfnh: 603	47: Record<string, number> = { ynujfntb: 724, qhmalpmt: 356, zogugazx: 697, nxevqauj: 390, xxclpdzt: 797, duoonecw: 742, htueblkp: 531, szhsfzjp: 836, yaimvzzx: 958, ywuzreuk: 754, cmkjvjyh: 149, telpnfnh: 834	48: Record<string, number> = { ynujfntb: 319, qhmalpmt: 677, zogugazx: 778, nxevqauj: 180, xxclpdzt: 379, duoonecw: 923, htueblkp: 9, szhsfzjp: 431, yaimvzzx: 952, ywuzreuk: 403, cmkjvjyh: 635, telpnfnh: 999	49: Record<string, number> = { ynujfntb: 137, qhmalpmt: 410, zogugazx: 17, nxevqauj: 407, xxclpdzt: 484, duoonecw: 364, htueblkp: 70, szhsfzjp: 496, yaimvzzx: 842, ywuzreuk: 420, cmkjvjyh: 563, telpnfnh: 312
50: Record<string, number> = { ynujfntb: 48, qhmalpmt: 172, zogugazx: 567, nxevqauj: 150, xxclpdzt: 137, duoonecw: 936, htueblkp: 814, szhsfzjp: 548, yaimvzzx: 48, ywuzreuk: 818, cmkjvjyh: 563, telpnfnh: 224	51: Record<string, number> = { ynujfntb: 873, qhmalpmt: 403, zogugazx: 155, nxevqauj: 598, xxclpdzt: 133, duoonecw: 576, htueblkp: 269, szhsfzjp: 221, yaimvzzx: 416, ywuzreuk: 806, cmkjvjyh: 63, telpnfnh: 631	52: Record<string, number> = { ynujfntb: 432, qhmalpmt: 416, zogugazx: 273, nxevqauj: 759, xxclpdzt: 894, duoonecw: 800, htueblkp: 791, szhsfzjp: 429, yaimvzzx: 662, ywuzreuk: 41, cmkjvjyh: 944, telpnfnh: 955	53: Record<string, number> = { ynujfntb: 535, qhmalpmt: 650, zogugazx: 670, nxevqauj: 226, xxclpdzt: 873, duoonecw: 634, htueblkp: 305, szhsfzjp: 451, yaimvzzx: 541, ywuzreuk: 241, cmkjvjyh: 979, telpnfnh: 675	54: Record<string, number> = { ynujfntb: 513, qhmalpmt: 282, zogugazx: 31, nxevqauj: 991, xxclpdzt: 922, duoonecw: 150, htueblkp: 318, szhsfzjp: 465, yaimvzzx: 468, ywuzreuk: 237, cmkjvjyh: 892, telpnfnh: 645
55: Record<string, number> = { ynujfntb: 546, qhmalpmt: 993, zogugazx: 653, nxevqauj: 205, xxclpdzt: 200, duoonecw: 253, htueblkp: 494, szhsfzjp: 959, yaimvzzx: 399, ywuzreuk: 711, cmkjvjyh: 292, telpnfnh: 711	56: Record<string, number> = { ynujfntb: 742, qhmalpmt: 33, zogugazx: 673, nxevqauj: 488, xxclpdzt: 516, duoonecw: 386, htueblkp: 358, szhsfzjp: 631, yaimvzzx: 995, ywuzreuk: 875, cmkjvjyh: 110, telpnfnh: 161	57: Record<string, number> = { ynujfntb: 627, qhmalpmt: 560, zogugazx: 296, nxevqauj: 933, xxclpdzt: 871, duoonecw: 181, htueblkp: 595, szhsfzjp: 11, yaimvzzx: 644, ywuzreuk: 371, cmkjvjyh: 640, telpnfnh: 174	58: Record<string, number> = { ynujfntb: 15, qhmalpmt: 582, zogugazx: 881, nxevqauj: 118, xxclpdzt: 78, duoonecw: 635, htueblkp: 587, szhsfzjp: 377, yaimvzzx: 385, ywuzreuk: 606, cmkjvjyh: 715, telpnfnh: 329	59: Record<string, number> = { ynujfntb: 11, qhmalpmt: 777, zogugazx: 538, nxevqauj: 101, xxclpdzt: 221, duoonecw: 390, htueblkp: 143, szhsfzjp: 390, yaimvzzx: 656, ywuzreuk: 938, cmkjvjyh: 193, telpnfnh: 226
60: Record<string, number> = { ynujfntb: 984, qhmalpmt: 374, zogugazx: 790, nxevqauj: 514, xxclpdzt: 54, duoonecw: 846, htueblkp: 800, szhsfzjp: 977, yaimvzzx: 870, ywuzreuk: 448, cmkjvjyh: 87, telpnfnh: 957	61: Record<string, number> = { ynujfntb: 735, qhmalpmt: 258, zogugazx: 604, nxevqauj: 223, xxclpdzt: 372, duoonecw: 177, htueblkp: 480, szhsfzjp: 307, yaimvzzx: 651, ywuzreuk: 251, cmkjvjyh: 564, telpnfnh: 265	62: Record<string, number> = { ynujfntb: 131, qhmalpmt: 629, zogugazx: 73, nxevqauj: 222, xxclpdzt: 982, duoonecw: 997, htueblkp: 415, szhsfzjp: 772, yaimvzzx: 577, ywuzreuk: 626, cmkjvjyh: 90, telpnfnh: 226	63: Record<string, number> = { ynujfntb: 53, qhmalpmt: 716, zogugazx: 496, nxevqauj: 371, xxclpdzt: 817, duoonecw: 259, htueblkp: 356, szhsfzjp: 59, yaimvzzx: 397, ywuzreuk: 599, cmkjvjyh: 120, telpnfnh: 664	64: Record<string, number> = { ynujfntb: 633, qhmalpmt: 954, zogugazx: 834, nxevqauj: 112, xxclpdzt: 956, duoonecw: 106, htueblkp: 71, szhsfzjp: 483, yaimvzzx: 383, ywuzreuk: 372, cmkjvjyh: 260, telpnfnh: 817
65: Record<string, number> = { ynujfntb: 365, qhmalpmt: 903, zogugazx: 53, nxevqauj: 793, xxclpdzt: 182, duoonecw: 506, htueblkp: 960, szhsfzjp: 707, yaimvzzx: 401, ywuzreuk: 30, cmkjvjyh: 135, telpnfnh: 714	66: Record<string, number> = { ynujfntb: 595, qhmalpmt: 580, zogugazx: 754, nxevqauj: 138, xxclpdzt: 416, duoonecw: 696, htueblkp: 561, szhsfzjp: 203, yaimvzzx: 466, ywuzreuk: 548, cmkjvjyh: 43, telpnfnh: 519	67: Record<string, number> = { ynujfntb: 976, qhmalpmt: 448, zogugazx: 92, nxevqauj: 784, xxclpdzt: 761, duoonecw: 767, htueblkp: 549, szhsfzjp: 740, yaimvzzx: 235, ywuzreuk: 362, cmkjvjyh: 303, telpnfnh: 969	68: Record<string, number> = { ynujfntb: 719, qhmalpmt: 678, zogugazx: 992, nxevqauj: 539, xxclpdzt: 629, duoonecw: 189, htueblkp: 662, szhsfzjp: 377, yaimvzzx: 478, ywuzreuk: 960, cmkjvjyh: 582, telpnfnh: 28	69: Record<string, number> = { ynujfntb: 678, qhmalpmt: 279, zogugazx: 369, nxevqauj: 701, xxclpdzt: 236, duoonecw: 557, htueblkp: 101, szhsfzjp: 969, yaimvzzx: 650, ywuzreuk: 107, cmkjvjyh: 481, telpnfnh: 986
70: Record<string, number> = { ynujfntb: 793, qhmalpmt: 79, zogugazx: 470, nxevqauj: 711, xxclpdzt: 511, duoonecw: 448, htueblkp: 395, szhsfzjp: 682, yaimvzzx: 90, ywuzreuk: 732, cmkjvjyh: 795, telpnfnh: 483	71: Record<string, number> = { ynujfntb: 373, qhmalpmt: 143, zogugazx: 954, nxevqauj: 150, xxclpdzt: 976, duoonecw: 52, htueblkp: 474, szhsfzjp: 917, yaimvzzx: 561, ywuzreuk: 72, cmkjvjyh: 104, telpnfnh: 309	72: Record<string, number> = { ynujfntb: 997, qhmalpmt: 195, zogugazx: 811, nxevqauj: 187, xxclpdzt: 11, duoonecw: 936, htueblkp: 523, szhsfzjp: 878, yaimvzzx: 135, ywuzreuk: 609, cmkjvjyh: 176, telpnfnh: 911	73: Record<string, number> = { ynujfntb: 508, qhmalpmt: 884, zogugazx: 348, nxevqauj: 227, xxclpdzt: 342, duoonecw: 276, htueblkp: 317, szhsfzjp: 604, yaimvzzx: 496, ywuzreuk: 413, cmkjvjyh: 973, telpnfnh: 173	74: Record<string, number> = { ynujfntb: 531, qhmalpmt: 557, zogugazx: 514, nxevqauj: 378, xxclpdzt: 962, duoonecw: 689, htueblkp: 818, szhsfzjp: 119, yaimvzzx: 858, ywuzreuk: 479, cmkjvjyh: 81, telpnfnh: 782
75: Record<string, number> = { ynujfntb: 154, qhmalpmt: 453, zogugazx: 966, nxevqauj: 880, xxclpdzt: 392, duoonecw: 800, htueblkp: 757, szhsfzjp: 597, yaimvzzx: 192, ywuzreuk: 116, cmkjvjyh: 406, telpnfnh: 995	76: Record<string, number> = { ynujfntb: 824, qhmalpmt: 765, zogugazx: 568, nxevqauj: 516, xxclpdzt: 805, duoonecw: 728, htueblkp: 318, szhsfzjp: 167, yaimvzzx: 650, ywuzreuk: 260, cmkjvjyh: 563, telpnfnh: 610	77: Record<string, number> = { ynujfntb: 49, qhmalpmt: 618, zogugazx: 81, nxevqauj: 834, xxclpdzt: 55, duoonecw: 292, htueblkp: 951, szhsfzjp: 392, yaimvzzx: 646, ywuzreuk: 503, cmkjvjyh: 844, telpnfnh: 230	78: Record<string, number> = { ynujfntb: 824, qhmalpmt: 84, zogugazx: 450, nxevqauj: 550, xxclpdzt: 612, duoonecw: 708, htueblkp: 551, szhsfzjp: 559, yaimvzzx: 266, ywuzreuk: 701, cmkjvjyh: 878, telpnfnh: 552	79: Record<string, number> = { ynujfntb: 432, qhmalpmt: 762, zogugazx: 173, nxevqauj: 327, xxclpdzt: 211, duoonecw: 266, htueblkp: 349, szhsfzjp: 130, yaimvzzx: 230, ywuzreuk: 400, cmkjvjyh: 145, telpnfnh: 854
80: Record<string, number> = { ynujfntb: 970, qhmalpmt: 769, zogugazx: 220, nxevqauj: 448, xxclpdzt: 904, duoonecw: 718, htueblkp: 357, szhsfzjp: 752, yaimvzzx: 909, ywuzreuk: 353, cmkjvjyh: 466, telpnfnh: 143	81: Record<string, number> = { ynujfntb: 83, qhmalpmt: 760, zogugazx: 660, nxevqauj: 580, xxclpdzt: 423, duoonecw: 388, htueblkp: 164, szhsfzjp: 168, yaimvzzx: 636, ywuzreuk: 410, cmkjvjyh: 25, telpnfnh: 543	82: Record<string, number> = { ynujfntb: 206, qhmalpmt: 416, zogugazx: 399, nxevqauj: 630, xxclpdzt: 586, duoonecw: 566, htueblkp: 395, szhsfzjp: 622, yaimvzzx: 182, ywuzreuk: 207, cmkjvjyh: 297, telpnfnh: 275	83: Record<string, number> = { ynujfntb: 413, qhmalpmt: 906, zogugazx: 750, nxevqauj: 0, xxclpdzt: 785, duoonecw: 377, htueblkp: 658, szhsfzjp: 404, yaimvzzx: 480, ywuzreuk: 273, cmkjvjyh: 766, telpnfnh: 944	84: Record<string, number> = { ynujfntb: 821, qhmalpmt: 559, zogugazx: 324, nxevqauj: 516, xxclpdzt: 326, duoonecw: 217, htueblkp: 705, szhsfzjp: 420, yaimvzzx: 150, ywuzreuk: 420, cmkjvjyh: 471, telpnfnh: 205
85: Record<string, number> = { ynujfntb: 446, qhmalpmt: 179, zogugazx: 264, nxevqauj: 925, xxclpdzt: 142, duoonecw: 215, htueblkp: 528, szhsfzjp: 739, yaimvzzx: 559, ywuzreuk: 752, cmkjvjyh: 750, telpnfnh: 615	86: Record<string, number> = { ynujfntb: 410, qhmalpmt: 595, zogugazx: 685, nxevqauj: 201, xxclpdzt: 286, duoonecw: 903, htueblkp: 197, szhsfzjp: 967, yaimvzzx: 742, ywuzreuk: 817, cmkjvjyh: 382, telpnfnh: 651	87: Record<string, number> = { ynujfntb: 669, qhmalpmt: 616, zogugazx: 402, nxevqauj: 351, xxclpdzt: 538, duoonecw: 458, htueblkp: 275, szhsfzjp: 749, yaimvzzx: 253, ywuzreuk: 545, cmkjvjyh: 157, telpnfnh: 343	88: Record<string, number> = { ynujfntb: 303, qhmalpmt: 625, zogugazx: 981, nxevqauj: 445, xxclpdzt: 826, duoonecw: 199, htueblkp: 123, szhsfzjp: 375, yaimvzzx: 561, ywuzreuk: 412, cmkjvjyh: 434, telpnfnh: 883	89: Record<string, number> = { ynujfntb: 677, qhmalpmt: 596, zogugazx: 834, nxevqauj: 863, xxclpdzt: 844, duoonecw: 796, htueblkp: 144, szhsfzjp: 101, yaimvzzx: 54, ywuzreuk: 84, cmkjvjyh: 635, telpnfnh: 161
90: Record<string, number> = { ynujfntb: 364, qhmalpmt: 138, zogugazx: 195, nxevqauj: 774, xxclpdzt: 762, duoonecw: 507, htueblkp: 674, szhsfzjp: 69, yaimvzzx: 43, ywuzreuk: 120, cmkjvjyh: 442, telpnfnh: 730	91: Record<string, number> = { ynujfntb: 620, qhmalpmt: 261, zogugazx: 623, nxevqauj: 964, xxclpdzt: 955, duoonecw: 676, htueblkp: 499, szhsfzjp: 968, yaimvzzx: 525, ywuzreuk: 570, cmkjvjyh: 207, telpnfnh: 847	92: Record<string, number> = { ynujfntb: 819, qhmalpmt: 703, zogugazx: 700, nxevqauj: 454, xxclpdzt: 375, duoonecw: 13, htueblkp: 964, szhsfzjp: 715, yaimvzzx: 73, ywuzreuk: 894, cmkjvjyh: 861, telpnfnh: 976	93: Record<string, number> = { ynujfntb: 257, qhmalpmt: 933, zogugazx: 340, nxevqauj: 139, xxclpdzt: 434, duoonecw: 353, htueblkp: 533, szhsfzjp: 737, yaimvzzx: 150, ywuzreuk: 465, cmkjvjyh: 281, telpnfnh: 154	94: Record<string, number> = { ynujfntb: 531, qhmalpmt: 776, zogugazx: 484, nxevqauj: 991, xxclpdzt: 123, duoonecw: 457, htueblkp: 662, szhsfzjp: 642, yaimvzzx: 550, ywuzreuk: 470, cmkjvjyh: 78, telpnfnh: 859
95: Record<string, number> = { ynujfntb: 652, qhmalpmt: 222, zogugazx: 729, nxevqauj: 409, xxclpdzt: 652, duoonecw: 893, htueblkp: 60, szhsfzjp: 289, yaimvzzx: 506, ywuzreuk: 155, cmkjvjyh: 995, telpnfnh: 421	96: Record<string, number> = { ynujfntb: 312, qhmalpmt: 409, zogugazx: 484, nxevqauj: 323, xxclpdzt: 10, duoonecw: 355, htueblkp: 892, szhsfzjp: 821, yaimvzzx: 856, ywuzreuk: 731, cmkjvjyh: 774, telpnfnh: 777	97: Record<string, number> = { ynujfntb: 616, qhmalpmt: 371, zogugazx: 572, nxevqauj: 560, xxclpdzt: 60, duoonecw: 244, htueblkp: 354, szhsfzjp: 352, yaimvzzx: 905, ywuzreuk: 431, cmkjvjyh: 844, telpnfnh: 146	98: Record<string, number> = { ynujfntb: 66, qhmalpmt: 891, zogugazx: 849, nxevqauj: 672, xxclpdzt: 975, duoonecw: 669, htueblkp: 310, szhsfzjp: 386, yaimvzzx: 917, ywuzreuk: 284, cmkjvjyh: 350, telpnfnh: 511	99: Record<string, number> = { ynujfntb: 282, qhmalpmt: 716, zogugazx: 89, nxevqauj: 639, xxclpdzt: 175, duoonecw: 140, htueblkp: 277, szhsfzjp: 52, yaimvzzx: 615, ywuzreuk: 884, cmkjvjyh: 497, telpnfnh: 373`,
        (n, a, b, c, d, e) => `  const t${a} };
  all.push(t${5 * n});
  const t${b} };
  all.push(t${5 * n + 1});
  const t${c} };
  all.push(t${5 * n + 2});
  const t${d} };
  all.push(t${5 * n + 3});
  const t${e} };
  all.push(t${5 * n + 4});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-any-optional-alias-literal-min.ts	any	?: K; k?: K; b?	!	5	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (-2147483648 as any) }) as H)	rest late-fields", () => { const s = make(); s.k = (-2147483648 as number); const { ...o } = s; keep(o); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i	wider-alias fresh", () => { const o = keep(make()); (o as Wide).k = (-2147483648 as number	multiply fresh", () => { const o = keep(make()); o.k! *= -2147483648	shift-left frozen", () => { const o = keep(make()); Object.freeze(o); o.k! <<= -2147483648	halve-the-value not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = (-2147483648 as number); o.k! /	for-of fresh", () => { const o = keep(make()); for (o.k of [(-2147483648 as number)]	define-value out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { value: (-2147483648 as any) }	super-store sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); putter.put.call(o, (-2147483648 as any)	for-each fresh", () => { const o = keep(make()); [(-2147483648 as number)].forEach(x => { o.k = x; }	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (-2147483648 as number); o.k = s.k;	all-three late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.a = (-2147483648 as number); o.k = (-2147483648 as number); o.b = (-2147483648 as number
fields-of-narrow-types/sample-any-plain-alias-literal-null.ts	any	: K; k: K; b		25	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (null as any) }) as H)	rest deleted", () => { const s = make(); s.k = (null as any); const { ...o } = s; keep(o); delete (o as any).k	wider-alias fresh", () => { const o = keep(make()); (o as Wide).k = (null as any	multiply fresh", () => { const o = keep(make()); o.k *= (null as any)	shift-left neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k <<= (null as any)	halve-the-value through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = (null as any); o.k /	for-of fresh", () => { const o = keep(make()); for (o.k of [(null as any)]	define-value local", () => { const o = (make()); Object.defineProperty(o, "k", { value: (null as any) }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k	super-store fresh", () => { const o = keep(make()); putter.put.call(o, (null as any)	for-each fresh", () => { const o = keep(make()); [(null as any)].forEach(x => { o.k = x; }	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (null as any); o.k = s.k;	all-three deleted", () => { const o = keep(make()); delete (o as any).k; o.a = (null as any); o.k = (null as any); o.b = (null as any
fields-of-narrow-types/sample-number-optional-alias-literal-min-plus-6.ts	number	?: K; k?: K; b?	!	11	spread-source out-of-slot", () => { const s = make(); s.k = (-2147483642 as number); const o: H = keep({ ...s }); (o as any).k = half	json-parse fresh", () => { const o = keep(JSON.parse('{"a":7,"k":-2147483642,"b":9}') as H)	as-any fresh", () => { const o = keep(make()); (o as any).k = (-2147483642 as any	postfix-decrement-value prototype", () => { const o = keep(make()); below = Object.create(o); o.k = (-2147483642 as number); note(o.k!--)	or late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k! |= -2147483642	multiply-the-value fresh", () => { const o = keep(make()); o.k = (-2147483642 as number); o.k! *	destructure-object never-stored", () => { const o = keep<H>({ a: 7, b: 9 }); ({ k: o.k } = { k: (-2147483642 as number) }	reflect-set frozen", () => { const o = keep(make()); Object.freeze(o); Reflect.set(o, "k", (-2147483642 as any)	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (-2147483642 as any) } }	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (-2147483642 as number	finally out-of-slot", () => { const o = keep(make()); (o as any).k = half; try { throw 1; } catch {} finally { o.k = (-2147483642 as number); }	twice fresh", () => { const o = keep(make()); o.k = (-2147483642 as number); o.k = 2; o.k = (-2147483642 as number
fields-of-narrow-types/sample-number-plain-alias-literal-array.ts	number	: K; k: K; b		31	spread-source local", () => { const s = make(); s.k = ([2] as any); const o: H = ({ ...s }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	json-parse fresh", () => { const o = keep(JSON.parse('{"a":7,"k":[2],"b":9}') as H)	as-any fresh", () => { const o = keep(make()); (o as any).k = ([2] as any	postfix-decrement-value sealed", () => { const o = keep(make()); Object.seal(o); o.k = ([2] as any); note(o.k--)	or deleted", () => { const o = keep(make()); delete (o as any).k; o.k |= ([2] as any)	multiply-the-value fresh", () => { const o = keep(make()); o.k = ([2] as any); o.k *	destructure-object out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = 2; ({ k: o.k } = { k: ([2] as any) }	reflect-set neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; Reflect.set(o, "k", ([2] as any)	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: ([2] as any) } }	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = ([2] as any	finally local", () => { const o = (make()); try { throw 1; } catch {} finally { o.k = ([2] as any); } note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k);	twice fresh", () => { const o = keep(make()); o.k = ([2] as any); o.k = 2; o.k = ([2] as any`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
type E = ${a};
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
type H = { a${b}: K; };
function make(): H { return { a: 7, k: 1, b: 9 }; }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k${c}++; }
function down(o: H): void { o.k${c}--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 7: return "seven"; case 2147483647: return "top"; case -2147483643: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: 7, k: 1, b: 9 }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${d}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("${e}; });
await t("${f}; });
await t("${g}); });
await t("${h}; });
await t("${i}; });
await t("${j}= 2; });
await t("${k}); });
await t("${l}); });
await t("${m}); });
await t("${o}); });
await t("${p} });
await t("${q}); });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-const-enum-or-null-class-constructor-false.ts	const 	null	a: K; k: K; b: K; constructor(k: K) { this.a = E.Seven; this.k = k; this.b = E.Nine; 	O	35	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (false as any) }) as H)	rest deleted", () => { const s = make(); s.k = (false as any); const { ...o } = s; keep(o); delete (o as any).k	wider-alias fresh", () => { const o = keep(make()); (o as Wide).k = (false as any	multiply fresh", () => { const o = keep(make()); o.k! *= (false as any	shift-left neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k! <<= (false as any)	halve-the-value through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = (false as any); o.k! /= 2	for-of fresh", () => { const o = keep(make()); for (o.k of [(false as any)])	define-value local", () => { const o = (make()); Object.defineProperty(o, "k", { value: (false as any) }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k	super-store fresh", () => { const o = keep(make()); putter.put.call(o, (false as any)	for-each fresh", () => { const o = keep(make()); [(false as any)].forEach(x => { o.k = x; }	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (false as any); o.k = s.k;	all-three deleted", () => { const o = keep(make()); delete (o as any).k; o.a = (false as any); o.k = (false as any); o.b = (false as any)
fields-of-narrow-types/sample-const-enum-or-undefined-parameter-property-bigint.ts	const 	undefined	constructor(public a: K, public k: K, public b: K) {	Seven, E.One, E.Ni	29	spread-small-source late-fields", () => { const o: H = keep({ ...make(), ...{ k: (1n as any) } }); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i	structured-clone fresh", () => { const s = make(); (s as any).k = (1n as any); const o: H = keep(structuredClone(s))	in-a-function fresh", () => { const o = keep(make()); put(o, (1n as any)	add frozen", () => { const o = keep(make()); Object.freeze(o); o.k! += (1n as any	and not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = E.Seven; o.k! &= (1n as any)	negate-the-value fresh", () => { const o = keep(make()); o.k = (1n as any); o.k = -o.k! as K	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(1n as any)]	reflect-set-receiver sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); Reflect.set(make(), "k", (1n as any), o	getter-over fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { get() { return (1n as any); }, enumerable: true, configurable: true }	evaluated-text fresh", () => { const o = keep(make()); unseen("o => { o.k = 1n; }")(o	swap late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.a = (1n as any); const x = o.a; o.a = o.k; o.k = x;	back-to-an-integer fresh", () => { const o = keep(make()); o.k = (1n as any); o.k = E.Two
fields-of-narrow-types/sample-enum-or-null-parameter-property-minus-zero.ts		null	constructor(public a: K, public k: K, public b: K) {	Seven, E.One, E.Ni	18	spread-source fresh", () => { const s = make(); s.k = (-0 as number); const o: H = keep({ ...s })	json-parse out-and-back", () => { const o = keep(JSON.parse('{"a":7,"k":-0,"b":9}') as H); (o as any).k = half; o.k = E.Two	as-any neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; (o as any).k = (-0 as any	postfix-decrement-value fresh", () => { const o = keep(make()); o.k = (-0 as number); note(o.k!--	or fresh", () => { const o = keep(make()); o.k! |= -0	multiply-the-value local", () => { const o = (make()); o.k = (-0 as number); o.k! *= 2; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	destructure-object fresh", () => { const o = keep(make()); ({ k: o.k } = { k: (-0 as number) })	reflect-set fresh", () => { const o = keep(make()); Reflect.set(o, "k", (-0 as any)	define-properties sealed", () => { const o = keep(make()); Object.seal(o); Object.defineProperties(o, { k: { value: (-0 as any) } }	proxy-above-with-a-trap deleted", () => { const o = keep(make()); delete (o as any).k; Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (-0 as number	finally fresh", () => { const o = keep(make()); try { throw 1; } catch {} finally { o.k = (-0 as number); }	twice out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.k = (-0 as number); o.k = E.Two; o.k = (-0 as number)`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
${a}enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E | ${b};
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { ${c}} }
function make(): H { return new H(E.${d}ne); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k!++; }
function down(o: H): void { o.k!--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${e}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("${f}; });
await t("${g}; });
await t("${h}); });
await t("${i}); });
await t("${j}; });
await t("${k}; });
await t("${l}; });
await t("${m}); });
await t("${o}); });
await t("${p}); });
await t("${q} });
await t("${r}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-any-plain-interface-literal-array.ts	31	sealed-out-of-slot", () => { const o: H = keep({ a: 7, k: ([2] as any), b: 9 }); (o as any).k = half; Object.seal(o	sealed-out-of-slot", () => { const o: H = keep({ ...make(), k: ([2] as any) }); (o as any).k = half; Object.seal(o	fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: ([2] as any) }) as H	fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: ([2] as any) })	structured-clone prototype", () => { const s = make(); (s as any).k = ([2] as any); const o: H = keep(structuredClone(s)); below = Object.create(o	prototype", () => { const o = keep(make()); below = Object.create(o); o.k = ([2] as any	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = ([2]	increment late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = ([2] as any); o.k++	subtract fresh", () => { const o = keep(make()); o.k -= ([2] as any)	or fresh", () => { const o = keep(make()); o.k |= ([2] as any)	shift-right-unsigned fresh", () => { const o = keep(make()); o.k = -2147483643; o.k >>>= ([2] as any)	halve-the-value frozen", () => { const o = keep(make()); Object.freeze(o); o.k = ([2] as any); o.k /= 2	array fresh", () => { const o = keep(make()); [o.k] = [([2] as any)]	assign-wider-layout not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); const s: Wide = { a: 7, k: ([2] as any), b: 9 }; Object.assign(o, s	all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: ([2] as any), writable: true, enumerable: true, configurable: tru	getter-then-value out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: ([2] as any), writable: true }	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = ([2] as any	replace sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); "a".replace("a", () => { o.k = ([2] as any); return ""; }	same-type fresh", () => { const o = keep(make()); const s = make(); s.k = ([2] as any); o.k = s.k	back-to-an-integer prototype", () => { const o = keep(make()); below = Object.create(o); o.k = ([2] as any); o.k = 2
fields-of-narrow-types/sample-any-plain-interface-literal-half.ts	16	fresh", () => { const o: H = keep({ a: 7, k: (0.5 as number), b: 9 }	fresh", () => { const o: H = keep({ ...make(), k: (0.5 as number) }	sealed-out-of-slot", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (0.5 as any) }) as H); (o as any).k = half; Object.seal(o	sealed-out-of-slot", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (0.5 as any) })); (o as any).k = half; Object.seal(o	structured-clone fresh", () => { const s = make(); (s as any).k = (0.5 as any); const o: H = keep(structuredClone(s)	fresh", () => { const o = keep(make()); o.k = (0.5 as number	computed-name prototype", () => { const o = keep(make()); below = Object.create(o); (o as any)[key] = (0.5	increment fresh", () => { const o = keep(make()); o.k = (0.5 as number); o.k++	subtract late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k -= 0.5	or fresh", () => { const o = keep(make()); o.k |= 0.5	shift-right-unsigned fresh", () => { const o = keep(make()); o.k = -2147483643; o.k >>>= 0.5	halve-the-value fresh", () => { const o = keep(make()); o.k = (0.5 as number); o.k /= 2	array frozen", () => { const o = keep(make()); Object.freeze(o); [o.k] = [(0.5 as number)]	assign-wider-layout fresh", () => { const o = keep(make()); const s: Wide = { a: 7, k: (0.5 as number), b: 9 }; Object.assign(o, s	all not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Object.defineProperty(o, "k", { value: (0.5 as any), writable: true, enumerable: true, configurable: tru	getter-then-value fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (0.5 as any), writable: true }	proxy-above-with-a-trap out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (0.5 as number	replace fresh", () => { const o = keep(make()); "a".replace("a", () => { o.k = (0.5 as number); return ""; }	same-type sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); const s = make(); s.k = (0.5 as number); o.k = s.k	back-to-an-integer fresh", () => { const o = keep(make()); o.k = (0.5 as number); o.k = 2
fields-of-narrow-types/sample-any-plain-interface-literal-object.ts	30	fresh", () => { const o: H = keep({ a: 7, k: ({} as any), b: 9 }	fresh", () => { const o: H = keep({ ...make(), k: ({} as any) }	sealed-out-of-slot", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: ({} as any) }) as H); (o as any).k = half; Object.seal(o	sealed-out-of-slot", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: ({} as any) })); (o as any).k = half; Object.seal(o	object-create fresh", () => { const o = keep(Object.create(Object.prototype, { a: { value: 7, writable: true, enumerable: true, configurable: true }, k: { value: ({} as any), writable: true, enumerable: true, configurable: true }, b: { value: 9, writable: true, enumerable: true, configurable: true } }) as H	fresh", () => { const o = keep(make()); o.k = ({} as any	as-any prototype", () => { const o = keep(make()); below = Object.create(o); (o as any).k = ({}	decrement fresh", () => { const o = keep(make()); o.k = ({} as any); o.k--	multiply late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k *= ({} as any)	and fresh", () => { const o = keep(make()); o.k = 7; o.k &= ({} as any)	add-to-the-value fresh", () => { const o = keep(make()); o.k = ({} as any); o.k += 1	nullish-assign fresh", () => { const o = keep(make()); (o as any).k = undefined; o.k ??= ({} as any)	default frozen", () => { const o = keep(make()); Object.freeze(o); ({ k: o.k = ({} as any) } = {} as { k?: K })	reflect-set fresh", () => { const o = keep(make()); Reflect.set(o, "k", ({} as any)	read-only not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Object.defineProperty(o, "k", { value: ({} as any), writable: fals	super-store fresh", () => { const o = keep(make()); putter.put.call(o, ({} as any)	evaluated-text out-of-slot", () => { const o = keep(make()); (o as any).k = half; unseen("o => { o.k = {}; }")(o	after-await fresh", async () => { const o = keep(make()); await null; o.k = ({} as any	wider-type sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); const s: Wide = { a: 7, k: ({} as any), b: 9 }; o.k = s.k as K	delete-after fresh", () => { const o = keep(make()); o.k = ({} as any); delete (o as any).k`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
type E = any;
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface H { a: K; k: K; b: K; }
function make(): H { return { a: 7, k: 1, b: 9 }; }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k++; }
function down(o: H): void { o.k--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 7: return "seven"; case 2147483647: return "top"; case -2147483643: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: 7, k: 1, b: 9 }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${a}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${b}); });
await t("spread-later-name ${c}); });
await t("assign-fresh-literal ${d}); });
await t("assign-typed-literal ${e}); });
await t("${f}); });
await t("typed-store ${g}); });
await t("${h} as any); });
await t("${i}; });
await t("${j}; });
await t("${k}; });
await t("${l}; });
await t("${m}; });
await t("destructure-${o}; });
await t("${p}); });
await t("define-${q}e }); });
await t("${r}); });
await t("${s}); });
await t("${t}); });
await t("copy-${u}; });
await t("${v}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-const-enum-optional-class-constructor-bigint.ts	const 	?: K; k?: K; b?: K; constructor(k?	!	29	late-fields", () => { const o: H = keep(new H((1n as any))); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i	late-fields", () => { const o: H = keep({ ...make(), k: (1n as any) }); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (1n as any) }) as H)	typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (1n as any) }))	structured-clone fresh", () => { const s = make(); (s as any).k = (1n as any); const o: H = keep(structuredClone(s))	typed-store fresh", () => { const o = keep(make()); o.k = (1n as any)	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = (1n as any	increment frozen", () => { const o = keep(make()); Object.freeze(o); o.k = (1n as any); o.k!++	subtract fresh", () => { const o = keep(make()); o.k! -= (1n as any)	or not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k! |= (1n as any)	shift-right-unsigned fresh", () => { const o = keep(make()); o.k = E.Low; o.k! >>>= (1n as any)	halve-the-value out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k = (1n as any); o.k! /= 2	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(1n as any)]	assign-wider-layout sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); const s: Wide = { a: 7, k: (1n as any), b: 9 }; Object.assign(o, s	define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (1n as any), writable: true, enumerable: true, configurable: true }	getter-then-value prototype", () => { const o = keep(make()); below = Object.create(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (1n as any), writable: true }	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (1n as any);	replace late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; "a".replace("a", () => { o.k = (1n as any); return ""; }	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (1n as any); o.k = s.k	back-to-an-integer fresh", () => { const o = keep(make()); o.k = (1n as any); o.k = E.Two
fields-of-narrow-types/sample-const-enum-optional-class-constructor-min-plus-4.ts	const 	?: K; k?: K; b?: K; constructor(k?	!	9	out-of-slot", () => { const o: H = keep(new H((-2147483644 as number))); (o as any).k = half	out-of-slot", () => { const o: H = keep({ ...make(), k: (-2147483644 as number) }); (o as any).k = half	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (-2147483644 as any) }) as H)	typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (-2147483644 as any) }))	structured-clone sealed-out-of-slot", () => { const s = make(); (s as any).k = (-2147483644 as any); const o: H = keep(structuredClone(s)); (o as any).k = half; Object.seal(o)	typed-store sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = (-2147483644 as number)	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = (-2147483644 as any	increment prototype", () => { const o = keep(make()); below = Object.create(o); o.k = (-2147483644 as number); o.k!++	subtract fresh", () => { const o = keep(make()); o.k! -= -2147483644	or late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k! |= -2147483644	shift-right-unsigned fresh", () => { const o = keep(make()); o.k = E.Low; o.k! >>>= -2147483644	halve-the-value fresh", () => { const o = keep(make()); o.k = (-2147483644 as number); o.k! /= 2	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(-2147483644 as number)]	assign-wider-layout frozen", () => { const o = keep(make()); Object.freeze(o); const s: Wide = { a: 7, k: (-2147483644 as number), b: 9 }; Object.assign(o, s	define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (-2147483644 as any), writable: true, enumerable: true, configurable: true }	getter-then-value not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (-2147483644 as any), writable: true }	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (-2147483644 as number);	replace out-of-slot", () => { const o = keep(make()); (o as any).k = half; "a".replace("a", () => { o.k = (-2147483644 as number); return ""; }	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (-2147483644 as number); o.k = s.k	back-to-an-integer sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = (-2147483644 as number); o.k = E.Two
fields-of-narrow-types/sample-const-enum-optional-class-constructor-ref.ts	const 	?: K; k?: K; b?: K; constructor(k?	!	36	fresh", () => { const o: H = keep(new H((ref as any)))	fresh", () => { const o: H = keep({ ...make(), k: (ref as any) })	spread-small-source fresh", () => { const o: H = keep({ ...make(), ...{ k: (ref as any) } })	fresh-literal out-of-slot", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (ref as any) }) as H); (o as any).k = half	assign-typed-literal out-of-slot", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (ref as any) })); (o as any).k = half	from-entries out-of-slot", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (ref as any)], ["b", E.Nine]]) as unknown as H); (o as any).k = half	typed-store fresh", () => { const o = keep(make()); o.k = (ref as any	in-an-untyped-function sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); putAny(o, (ref as any))	postfix-decrement-value fresh", () => { const o = keep(make()); o.k = (ref as any); note(o.k!--)	remainder prototype", () => { const o = keep(make()); below = Object.create(o); o.k = E.Seven; o.k! %= (ref as any)	shift-left fresh", () => { const o = keep(make()); o.k! <<= (ref as any)	negate-the-value late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (ref as any); o.k = -o.k! as K	and-assign fresh", () => { const o = keep(make()); o.k &&= (ref as any)	assign fresh", () => { const o = keep(make()); Object.assign(o, { k: (ref as any) }	reflect-set-empty-target fresh", () => { const o = keep(make()); Reflect.set({}, "k", (ref as any), o	define-properties frozen", () => { const o = keep(make()); Object.freeze(o); Object.defineProperties(o, { k: { value: (ref as any) } }	setter-on-the-prototype fresh", () => { const o = keep(make()); const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (ref as any); } finally { delete above.k; }	for-each not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); [(ref as any)].forEach(x => { o.k = x; }	swap fresh", () => { const o = keep(make()); o.a = (ref as any); const x = o.a; o.a = o.k; o.k = x	conditional out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k = never ? E.One : (ref as any)
fields-of-narrow-types/sample-enum-plain-class-constructor-array.ts		: K; k: K; b: K; constructor(k		31	deleted", () => { const o: H = keep(new H(([2] as any))); delete (o as any).k	deleted", () => { const o: H = keep({ ...make(), k: ([2] as any) }); delete (o as any).k	spread-small-source deleted", () => { const o: H = keep({ ...make(), ...{ k: ([2] as any) } }); delete (o as any).k	fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: ([2] as any) }) as H)	assign-typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: ([2] as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", ([2] as any)], ["b", E.Nine]]) as unknown as H)	typed-store out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.k = ([2] as any	in-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, ([2] as any))	postfix-decrement-value neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = ([2] as any); note(o.k--)	remainder fresh", () => { const o = keep(make()); o.k = E.Seven; o.k %= ([2] as any)	shift-left through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k <<= ([2] as any)	negate-the-value fresh", () => { const o = keep(make()); o.k = ([2] as any); o.k = -o.k as K	and-assign local", () => { const o = (make()); o.k &&= ([2] as any); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	assign fresh", () => { const o = keep(make()); Object.assign(o, { k: ([2] as any) }	reflect-set-empty-target fresh", () => { const o = keep(make()); Reflect.set({}, "k", ([2] as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: ([2] as any) } }	setter-on-the-prototype sealed", () => { const o = keep(make()); Object.seal(o); const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = ([2] as any); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [([2] as any)].forEach(x => { o.k = x; }	swap deleted", () => { const o = keep(make()); delete (o as any).k; o.a = ([2] as any); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? E.One : ([2] as any)
fields-of-narrow-types/sample-enum-plain-class-constructor-half.ts		: K; k: K; b: K; constructor(k		16	fresh", () => { const o: H = keep(new H((0.5 as number)))	fresh", () => { const o: H = keep({ ...make(), k: (0.5 as number) })	spread-small-source fresh", () => { const o: H = keep({ ...make(), ...{ k: (0.5 as number) } })	fresh-literal deleted", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (0.5 as any) }) as H); delete (o as any).k	assign-typed-literal deleted", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (0.5 as any) })); delete (o as any).k	from-entries deleted", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (0.5 as any)], ["b", E.Nine]]) as unknown as H); delete (o as any).k	typed-store fresh", () => { const o = keep(make()); o.k = (0.5 as number	in-an-untyped-function out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; putAny(o, (0.5 as any))	postfix-decrement-value fresh", () => { const o = keep(make()); o.k = (0.5 as number); note(o.k--)	remainder neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = E.Seven; o.k %= 0.5	shift-left fresh", () => { const o = keep(make()); o.k <<= 0.5	negate-the-value through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = (0.5 as number); o.k = -o.k as K	and-assign fresh", () => { const o = keep(make()); o.k &&= (0.5 as number)	assign local", () => { const o = (make()); Object.assign(o, { k: (0.5 as any) }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k	reflect-set-empty-target fresh", () => { const o = keep(make()); Reflect.set({}, "k", (0.5 as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (0.5 as any) } }	setter-on-the-prototype fresh", () => { const o = keep(make()); const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (0.5 as number); } finally { delete above.k; }	for-each sealed", () => { const o = keep(make()); Object.seal(o); [(0.5 as number)].forEach(x => { o.k = x; }	swap fresh", () => { const o = keep(make()); o.a = (0.5 as number); const x = o.a; o.a = o.k; o.k = x	conditional deleted", () => { const o = keep(make()); delete (o as any).k; o.k = never ? E.One : (0.5 as number)
fields-of-narrow-types/sample-enum-plain-class-constructor-tiny.ts		: K; k: K; b: K; constructor(k		23	through-text", () => { const o: H = keep(new H((5e-324 as number))); unseen("o => { o.k; return Object.keys(o); }")(o)	through-text", () => { const o: H = keep({ ...make(), k: (5e-324 as number) }); unseen("o => { o.k; return Object.keys(o); }")(o)	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (5e-324 as any) }) as H)	typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (5e-324 as any) }))	object-create local", () => { const o = (Object.create(Object.prototype, { a: { value: E.Seven, writable: true, enumerable: true, configurable: true }, k: { value: (5e-324 as any), writable: true, enumerable: true, configurable: true }, b: { value: E.Nine, writable: true, enumerable: true, configurable: true } }) as H); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	typed-store local", () => { const o = (make()); o.k = (5e-324 as number); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	as-any fresh", () => { const o = keep(make()); (o as any).k = (5e-324 as any	decrement fresh", () => { const o = keep(make()); o.k = (5e-324 as number); o.k--	multiply fresh", () => { const o = keep(make()); o.k *= 5e-324	and sealed", () => { const o = keep(make()); Object.seal(o); o.k = E.Seven; o.k &= 5e-324	add-to-the-value fresh", () => { const o = keep(make()); o.k = (5e-324 as number); o.k += 1	nullish-assign deleted", () => { const o = keep(make()); delete (o as any).k; (o as any).k = undefined; o.k ??= (5e-324 as number)	destructure-default fresh", () => { const o = keep(make()); ({ k: o.k = (5e-324 as number) } = {} as { k?: K })	reflect-set out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; Reflect.set(o, "k", (5e-324 as any)	define-read-only fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (5e-324 as any), writable: false }	super-store neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; putter.put.call(o, (5e-324 as any)	evaluated-text fresh", () => { const o = keep(make()); unseen("o => { o.k = 5e-324; }")(o);	after-await through-text", async () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); await null; o.k = (5e-324 as number	copy-wider-type fresh", () => { const o = keep(make()); const s: Wide = { a: 7, k: (5e-324 as number), b: 9 }; o.k = s.k as K	delete-after local", () => { const o = (make()); o.k = (5e-324 as number); delete (o as any).k; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)
fields-of-narrow-types/sample-enum-plain-class-constructor-value-of.ts		: K; k: K; b: K; constructor(k		34	fresh", () => { const o: H = keep(new H((withValueOf as any)))	fresh", () => { const o: H = keep({ ...make(), k: (withValueOf as any) })	assign-fresh-literal neighbors-out-of-slot", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (withValueOf as any) }) as H); (o as any).a = half; (o as any).b = half	typed-literal neighbors-out-of-slot", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (withValueOf as any) })); (o as any).a = half; (o as any).b = half	structured-clone fresh", () => { const s = make(); (s as any).k = (withValueOf as any); const o: H = keep(structuredClone(s))	typed-store fresh", () => { const o = keep(make()); o.k = (withValueOf as any)	computed-name through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); (o as any)[key] = (withValueOf as any	increment fresh", () => { const o = keep(make()); o.k = (withValueOf as any); o.k++	subtract local", () => { const o = (make()); o.k -= (withValueOf as any); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	or fresh", () => { const o = keep(make()); o.k |= (withValueOf as any)	shift-right-unsigned fresh", () => { const o = keep(make()); o.k = E.Low; o.k >>>= (withValueOf as any)	halve-the-value fresh", () => { const o = keep(make()); o.k = (withValueOf as any); o.k /= 2	destructure-array sealed", () => { const o = keep(make()); Object.seal(o); [o.k] = [(withValueOf as any)]	assign-wider-layout fresh", () => { const o = keep(make()); const s: Wide = { a: 7, k: (withValueOf as any), b: 9 }; Object.assign(o, s	define-all deleted", () => { const o = keep(make()); delete (o as any).k; Object.defineProperty(o, "k", { value: (withValueOf as any), writable: true, enumerable: true, configurable: true }	getter-then-value fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (withValueOf as any), writable: true }	proxy-above-with-a-trap out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (withValueOf as any);	replace fresh", () => { const o = keep(make()); "a".replace("a", () => { o.k = (withValueOf as any); return ""; }	copy-same-type neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; const s = make(); s.k = (withValueOf as any); o.k = s.k	back-to-an-integer fresh", () => { const o = keep(make()); o.k = (withValueOf as any); o.k = E.Two`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
        w,
        x,
        y,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
${a}enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { a${b}: K) { this.a = E.Seven; this.k = k; this.b = E.Nine; } }
function make(): H { return new H(E.One); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k${c}++; }
function down(o: H): void { o.k${c}--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${d}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${e}; });
await t("spread-later-name ${f}; });
await t("${g}; });
await t("assign-${h}; });
await t("${i}; });
await t("${j}; });
await t("${k}); });
await t("${l}; });
await t("${m}; });
await t("${o}; });
await t("${p}; });
await t("${q}; });
await t("${r}; });
await t("${s}); });
await t("${t}); });
await t("${u}); });
await t("${v} });
await t("${w}); });
await t("${x}; });
await t("${y}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-enum-or-undefined-parameter-property-false.ts	35	sealed-out-of-slot", () => { const o: H = keep(new H(E.Seven, (false as any), E.Nine)); (o as any).k = half; Object.seal	sealed-out-of-slot", () => { const o: H = keep({ ...make(), k: (false as any) }); (o as any).k = half; Object.seal	spread-small-source sealed-out-of-slot", () => { const o: H = keep({ ...make(), ...{ k: (false as any) } }); (o as any).k = half; Object.seal(o	fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (false as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (false as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (false as any)], ["b", E.Nine]]) as unknown as H	typed-store prototype", () => { const o = keep(make()); below = Object.create(o); o.k = (false as any	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (false as any))	postfix-decrement-value late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (false as any); note(o.k!--)	remainder fresh", () => { const o = keep(make()); o.k = E.Seven; o.k! %= (false as any)	left fresh", () => { const o = keep(make()); o.k! <<= (false as any)	negate-the-value fresh", () => { const o = keep(make()); o.k = (false as any); o.k = -o.k! as K	and-assign frozen", () => { const o = keep(make()); Object.freeze(o); o.k &&= (false as any)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (false as any) }	reflect-set-empty-target not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Reflect.set({}, "k", (false as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (false as any) }	setter-on-the-prototype out-of-slot", () => { const o = keep(make()); (o as any).k = half; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (false as any); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(false as any)].forEach(x => { o.k = x	swap sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.a = (false as any); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? E.One : (false as any)
fields-of-narrow-types/sample-enum-or-undefined-parameter-property-max.ts	3	not-extensible", () => { const o: H = keep(new H(E.Seven, (2147483647 as number), E.Nine)); Object.preventExtensions	not-extensible", () => { const o: H = keep({ ...make(), k: (2147483647 as number) }); Object.preventExtensions	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (2147483647 as any) }) as H	typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (2147483647 as any) })	structured-clone out-of-slot", () => { const s = make(); (s as any).k = (2147483647 as any); const o: H = keep(structuredClone(s)); (o as any).k = half	typed-store out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k = (2147483647 as number	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = (2147483647 as any	crement sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = (2147483647 as number); o.k!++	subtract fresh", () => { const o = keep(make()); o.k! -= 2147483647	or prototype", () => { const o = keep(make()); below = Object.create(o); o.k! |= 2147483647	right-unsigned fresh", () => { const o = keep(make()); o.k = E.Low; o.k! >>>= 2147483647	halve-the-value late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (2147483647 as number); o.k! /= 2	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(2147483647 as number)]	-wider-layout fresh", () => { const o = keep(make()); const s: Wide = { a: 7, k: (2147483647 as number), b: 9 }; Object.assign(o, s	define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true, enumerable: true, configurable: true }	getter-then-value frozen", () => { const o = keep(make()); Object.freeze(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (2147483647 as number);	replace not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); "a".replace("a", () => { o.k = (2147483647 as number); return ""	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (2147483647 as number); o.k = s.k	back-to-an-integer out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k = (2147483647 as number); o.k = E.Two
fields-of-narrow-types/sample-enum-or-undefined-parameter-property-two-to-53.ts	15	frozen", () => { const o: H = keep(new H(E.Seven, (9007199254740992 as number), E.Nine)); Object.freeze	frozen", () => { const o: H = keep({ ...make(), k: (9007199254740992 as number) }); Object.freeze	spread-small-source frozen", () => { const o: H = keep({ ...make(), ...{ k: (9007199254740992 as number) } }); Object.freeze(o	fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (9007199254740992 as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (9007199254740992 as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (9007199254740992 as any)], ["b", E.Nine]]) as unknown as H	typed-store not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = (9007199254740992 as number	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (9007199254740992 as any))	postfix-decrement-value out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k = (9007199254740992 as number); note(o.k!--)	remainder fresh", () => { const o = keep(make()); o.k = E.Seven; o.k! %= 9007199254740992	left sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k! <<= 9007199254740992	negate-the-value fresh", () => { const o = keep(make()); o.k = (9007199254740992 as number); o.k = -o.k! as K	and-assign prototype", () => { const o = keep(make()); below = Object.create(o); o.k &&= (9007199254740992 as number)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (9007199254740992 as any) }	reflect-set-empty-target late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; Reflect.set({}, "k", (9007199254740992 as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (9007199254740992 as any) }	setter-on-the-prototype fresh", () => { const o = keep(make()); const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (9007199254740992 as number); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(9007199254740992 as number)].forEach(x => { o.k = x	swap frozen", () => { const o = keep(make()); Object.freeze(o); o.a = (9007199254740992 as number); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? E.One : (9007199254740992 as number)`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E | undefined;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { constructor(public a: K, public k: K, public b: K) {} }
function make(): H { return new H(E.Seven, E.One, E.Nine); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k!++; }
function down(o: H): void { o.k!--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${a}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${b}(o); });
await t("spread-later-name ${c}(o); });
await t("${d}); });
await t("assign-${e}); });
await t("${f}; });
await t("${g}); });
await t("${h}); });
await t("in${i}; });
await t("${j}; });
await t("${k}; });
await t("shift-${l}; });
await t("${m}; });
await t("${o}; });
await t("assign${p}); });
await t("${q}); });
await t("${r} }); });
await t("${s} });
await t("${t}; }); });
await t("${u}; });
await t("${v}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-number-plain-class-constructor-false.ts	35	through-text", () => { const o: H = keep(new H((false as any))); unseen("o => { o.k; return Object.keys(o); }")(o)	through-text", () => { const o: H = keep({ ...make(), k: (false as any) }); unseen("o => { o.k; return Object.keys(o); }")(o)	spread-small-source through-text", () => { const o: H = keep({ ...make(), ...{ k: (false as any) } }); unseen("o => { o.k; return Object.keys(o); }")(o)	fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (false as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (false as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", 7], ["k", (false as any)], ["b", 9]]) as unknown as H	typed-store local", () => { const o = (make()); o.k = (false as any); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (false as any))	postfix-decrement-value fresh", () => { const o = keep(make()); o.k = (false as any); note(o.k--)	remainder fresh", () => { const o = keep(make()); o.k = 7; o.k %= (false as any)	left sealed", () => { const o = keep(make()); Object.seal(o); o.k <<= (false as any)	negate-the-value fresh", () => { const o = keep(make()); o.k = (false as any); o.k = -o.k as K	and-assign deleted", () => { const o = keep(make()); delete (o as any).k; o.k &&= (false as any)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (false as any) }	reflect-set-empty-target out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = 2; Reflect.set({}, "k", (false as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (false as any) }	setter-on-the-prototype neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (false as any); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(false as any)].forEach(x => { o.k = x	swap through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.a = (false as any); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? 1 : (false as any)
fields-of-narrow-types/sample-number-plain-class-constructor-max.ts	3	out-and-back", () => { const o: H = keep(new H((2147483647 as number))); (o as any).k = half; o.k = 2	out-and-back", () => { const o: H = keep({ ...make(), k: (2147483647 as number) }); (o as any).k = half; o.k = 2	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (2147483647 as any) }) as H)	typed-literal fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (2147483647 as any) })	structured-clone neighbors-out-of-slot", () => { const s = make(); (s as any).k = (2147483647 as any); const o: H = keep(structuredClone(s)); (o as any).a = half; (o as any).b = half	typed-store neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = (2147483647 as number	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = (2147483647 as any	crement through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = (2147483647 as number); o.k++	subtract fresh", () => { const o = keep(make()); o.k -= 2147483647	or local", () => { const o = (make()); o.k |= 2147483647; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	right-unsigned fresh", () => { const o = keep(make()); o.k = -2147483643; o.k >>>= 2147483647	halve-the-value fresh", () => { const o = keep(make()); o.k = (2147483647 as number); o.k /= 2	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(2147483647 as number)]	-wider-layout sealed", () => { const o = keep(make()); Object.seal(o); const s: Wide = { a: 7, k: (2147483647 as number), b: 9 }; Object.assign(o, s	define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true, enumerable: true, configurable: true }	getter-then-value deleted", () => { const o = keep(make()); delete (o as any).k; Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (2147483647 as number);	replace out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = 2; "a".replace("a", () => { o.k = (2147483647 as number); return ""	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (2147483647 as number); o.k = s.k	back-to-an-integer neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = (2147483647 as number); o.k = 2
fields-of-narrow-types/sample-number-plain-class-constructor-two-to-53.ts	15	deleted", () => { const o: H = keep(new H((9007199254740992 as number))); delete (o as any).k	deleted", () => { const o: H = keep({ ...make(), k: (9007199254740992 as number) }); delete (o as any).k	spread-small-source deleted", () => { const o: H = keep({ ...make(), ...{ k: (9007199254740992 as number) } }); delete (o as any).k	fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (9007199254740992 as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (9007199254740992 as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", 7], ["k", (9007199254740992 as any)], ["b", 9]]) as unknown as H	typed-store out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = 2; o.k = (9007199254740992 as number	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (9007199254740992 as any))	postfix-decrement-value neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = (9007199254740992 as number); note(o.k--)	remainder fresh", () => { const o = keep(make()); o.k = 7; o.k %= 9007199254740992	left through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k <<= 9007199254740992	negate-the-value fresh", () => { const o = keep(make()); o.k = (9007199254740992 as number); o.k = -o.k as K	and-assign local", () => { const o = (make()); o.k &&= (9007199254740992 as number); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (9007199254740992 as any) }	reflect-set-empty-target fresh", () => { const o = keep(make()); Reflect.set({}, "k", (9007199254740992 as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (9007199254740992 as any) }	setter-on-the-prototype sealed", () => { const o = keep(make()); Object.seal(o); const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (9007199254740992 as number); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(9007199254740992 as number)].forEach(x => { o.k = x	swap deleted", () => { const o = keep(make()); delete (o as any).k; o.a = (9007199254740992 as number); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? 1 : (9007199254740992 as number)`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
type E = number;
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { a: K; k: K; b: K; constructor(k: K) { this.a = 7; this.k = k; this.b = 9; } }
function make(): H { return new H(1); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k++; }
function down(o: H): void { o.k--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 7: return "seven"; case 2147483647: return "top"; case -2147483643: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: 7, k: 1, b: 9 }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${a}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${b}; });
await t("spread-later-name ${c}; });
await t("${d}; });
await t("assign-${e}); });
await t("${f}; });
await t("${g}); });
await t("${h}); });
await t("in${i}; });
await t("${j}; });
await t("${k}; });
await t("shift-${l}; });
await t("${m}; });
await t("${o}; });
await t("assign${p}); });
await t("${q}); });
await t("${r} }); });
await t("${s} });
await t("${t}; }); });
await t("${u}; });
await t("${v}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-union-or-null-class-initializer-false.ts	false as any	35	fresh", () => { const o: H = keep((pending = (false as any), new HI())	fresh", () => { const o: H = keep({ ...make(), k: (false as any) }	spread-small-source fresh", () => { const o: H = keep({ ...make(), ...{ k: (false as any) } }	fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (false as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (false as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", 7], ["k", (false as any)], ["b", 9]]) as unknown as H	typed-store frozen", () => { const o = keep(make()); Object.freeze(o); o.k = (false as any	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (false as any))	postfix-decrement-value not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = (false as any); note(o.k!--	remainder fresh", () => { const o = keep(make()); o.k = 7; o.k! %= (false	left out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k! <<= (false	negate-the-value fresh", () => { const o = keep(make()); o.k = (false as any); o.k = -o.k! as K	and-assign sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k &&= (false as any)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (false as any) }	reflect-set-empty-target prototype", () => { const o = keep(make()); below = Object.create(o); Reflect.set({}, "k", (false as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (false as any) }	setter-on-the-prototype late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (false as any); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(false as any)].forEach(x => { o.k = x	swap fresh", () => { const o = keep(make()); o.a = (false as any); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? 1 : (false as any)
fields-of-narrow-types/sample-union-or-null-class-initializer-max.ts	2147483647 as E	3	prototype", () => { const o: H = keep((pending = (2147483647 as any), new HI())); below = Object.create(o	prototype", () => { const o: H = keep({ ...make(), k: (2147483647 as E) }); below = Object.create(o	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (2147483647 as any) }) as H	typed-literal fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (2147483647 as any) })	structured-clone late-fields", () => { const s = make(); (s as any).k = (2147483647 as any); const o: H = keep(structuredClone(s)); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i	typed-store late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (2147483647 as E	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = (2147483647 as any	crement fresh", () => { const o = keep(make()); o.k = (2147483647 as E); o.k!++	subtract fresh", () => { const o = keep(make()); o.k! -= (2147483647 as any	or frozen", () => { const o = keep(make()); Object.freeze(o); o.k! |= (2147483647	right-unsigned fresh", () => { const o = keep(make()); o.k = -2147483643; o.k! >>>= (2147483647	halve-the-value not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = (2147483647 as E); o.k! /= 2	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(2147483647 as E)]	-wider-layout out-of-slot", () => { const o = keep(make()); (o as any).k = half; const s: Wide = { a: 7, k: (2147483647 as number), b: 9 }; Object.assign(o, s	define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true, enumerable: true, configurable: true }	getter-then-value sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (2147483647 as E);	replace prototype", () => { const o = keep(make()); below = Object.create(o); "a".replace("a", () => { o.k = (2147483647 as E); return ""	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (2147483647 as E); o.k = s.k	back-to-an-integer late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (2147483647 as E); o.k = 2
fields-of-narrow-types/sample-union-or-null-class-initializer-two-to-53.ts	9007199254740992 as E	15	sealed-out-of-slot", () => { const o: H = keep((pending = (9007199254740992 as any), new HI())); (o as any).k = half; Object.seal(o	sealed-out-of-slot", () => { const o: H = keep({ ...make(), k: (9007199254740992 as E) }); (o as any).k = half; Object.seal(o	spread-small-source sealed-out-of-slot", () => { const o: H = keep({ ...make(), ...{ k: (9007199254740992 as E) } }); (o as any).k = half; Object.seal(o	fresh-literal fresh", () => { const o = keep(Object.assign({ a: 7, k: 1, b: 9 }, { k: (9007199254740992 as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: 7, k: 1, b: 9 }; const o: H = keep(Object.assign(fresh, { k: (9007199254740992 as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", 7], ["k", (9007199254740992 as any)], ["b", 9]]) as unknown as H	typed-store prototype", () => { const o = keep(make()); below = Object.create(o); o.k = (9007199254740992 as E	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (9007199254740992 as any))	postfix-decrement-value late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (9007199254740992 as E); note(o.k!--	remainder fresh", () => { const o = keep(make()); o.k = 7; o.k! %= (9007199254740992	left fresh", () => { const o = keep(make()); o.k! <<= (9007199254740992	negate-the-value fresh", () => { const o = keep(make()); o.k = (9007199254740992 as E); o.k = -o.k! as K	and-assign frozen", () => { const o = keep(make()); Object.freeze(o); o.k &&= (9007199254740992 as E)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (9007199254740992 as any) }	reflect-set-empty-target not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Reflect.set({}, "k", (9007199254740992 as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (9007199254740992 as any) }	setter-on-the-prototype out-of-slot", () => { const o = keep(make()); (o as any).k = half; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (9007199254740992 as E); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(9007199254740992 as E)].forEach(x => { o.k = x	swap sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.a = (9007199254740992 as E); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? 1 : (9007199254740992 as E)`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
        w,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
type E = 0 | 1 | 2 | 7 | 9 | 2147483647 | -2147483643;
type K = E | null;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { a: K = 7; k: K = 1; b: K = 9; }
class HI { a: K = 7; k: K = (${a}); b: K = 9; }
function make(): H { return new H(); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k!++; }
function down(o: H): void { o.k!--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 7: return "seven"; case 2147483647: return "top"; case -2147483643: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: 7, k: 1, b: 9 }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${b}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${c}); });
await t("spread-later-name ${d}); });
await t("${e}); });
await t("assign-${f}); });
await t("${g}; });
await t("${h}); });
await t("${i}); });
await t("in${j}; });
await t("${k}); });
await t("${l} as any); });
await t("shift-${m} as any); });
await t("${o}; });
await t("${p}; });
await t("assign${q}); });
await t("${r}); });
await t("${s} }); });
await t("${t} });
await t("${u}; }); });
await t("${v}; });
await t("${w}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-const-enum-optional-class-constructor-large.ts	const 	?: K; k?: K; b?: K; constructor(k?	!	22	fresh", () => { const o: H = keep(new H((1e21 as number)))	fresh", () => { const o: H = keep({ ...make(), k: (1e21 as number) })	fresh", () => { const s = make(); s.k = (1e21 as number); const o: H = keep({ ...s })	out-of-slot", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (1e21 as any) }) as H); (o as any).k = half	out-of-slot", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (1e21 as any) })); (o as any).k = half	out-of-slot", () => { const s = make(); s.k = (1e21 as number); const o = keep(Object.assign({}, s) as H); (o as any).k = half	fresh", () => { const s = make(); s.k = (1e21 as number); const { ...o } = s; keep(o)	fresh", () => { const o = keep(make()); o.k = (1e21	sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); put(o, (1e21	fresh", () => { const o = keep(make()); o.k = (1e21 as number); note(++o.k!	prototype", () => { const o = keep(make()); below = Object.create(o); o.k! /= 1e21	fresh", () => { const o = keep(make()); o.k! ^= 1e21	late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (1e21 as number); o.k!	fresh", () => { const o = keep(make()); o.k = E.Zero; o.k ||= (1e21 as number	fresh", () => { const o = keep(make()); for (o.k of [(1e21	fresh", () => { const o = keep(make()); Reflect.set(make(), "k", (1e21	frozen", () => { const o = keep(make()); Object.freeze(o); Object.defineProperty(o, "k", { value: (1e21	fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = (1e21	not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); new Function("o", "v", "o.k = v;")(o, (1e21	fresh", () => { const o = keep(make()); try { throw 1; } catch {} finally { o.k = (1e21	out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.a = (1e21	fresh", () => { const o = keep(make()); o.a = (1e21 as number); o.k = (1e21 as number); o.b = (1e21
fields-of-narrow-types/sample-const-enum-optional-class-constructor-minus-one.ts	const 	?: K; k?: K; b?: K; constructor(k?	!	2	fresh", () => { const o: H = keep(new H((-1 as number)))	fresh", () => { const o: H = keep({ ...make(), k: (-1 as number) })	fresh", () => { const s = make(); s.k = (-1 as number); const o: H = keep({ ...s })	fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (-1 as any) }) as H)	fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (-1 as any) }))	fresh", () => { const s = make(); s.k = (-1 as number); const o = keep(Object.assign({}, s) as H)	fresh", () => { const s = make(); s.k = (-1 as number); const { ...o } = s; keep(o)	fresh", () => { const o = keep(make()); o.k = (-1	frozen", () => { const o = keep(make()); Object.freeze(o); put(o, (-1	fresh", () => { const o = keep(make()); o.k = (-1 as number); note(++o.k!	not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k! /= -1	fresh", () => { const o = keep(make()); o.k! ^= -1	out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k = (-1 as number); o.k!	fresh", () => { const o = keep(make()); o.k = E.Zero; o.k ||= (-1 as number	sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); for (o.k of [(-1	fresh", () => { const o = keep(make()); Reflect.set(make(), "k", (-1	prototype", () => { const o = keep(make()); below = Object.create(o); Object.defineProperty(o, "k", { value: (-1	fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = (-1	late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; new Function("o", "v", "o.k = v;")(o, (-1	fresh", () => { const o = keep(make()); try { throw 1; } catch {} finally { o.k = (-1	fresh", () => { const o = keep(make()); o.a = (-1	fresh", () => { const o = keep(make()); o.a = (-1 as number); o.k = (-1 as number); o.b = (-1
fields-of-narrow-types/sample-const-enum-optional-class-constructor-two-to-31.ts	const 	?: K; k?: K; b?: K; constructor(k?	!	12	fresh", () => { const o: H = keep(new H((2147483648 as number)))	fresh", () => { const o: H = keep({ ...make(), k: (2147483648 as number) })	fresh", () => { const s = make(); s.k = (2147483648 as number); const o: H = keep({ ...s })	prototype", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (2147483648 as any) }) as H); below = Object.create(o)	prototype", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (2147483648 as any) })); below = Object.create(o)	prototype", () => { const s = make(); s.k = (2147483648 as number); const o = keep(Object.assign({}, s) as H); below = Object.create(o)	fresh", () => { const s = make(); s.k = (2147483648 as number); const { ...o } = s; keep(o)	fresh", () => { const o = keep(make()); o.k = (2147483648	late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; put(o, (2147483648	fresh", () => { const o = keep(make()); o.k = (2147483648 as number); note(++o.k!	fresh", () => { const o = keep(make()); o.k! /= 2147483648	fresh", () => { const o = keep(make()); o.k! ^= 2147483648	frozen", () => { const o = keep(make()); Object.freeze(o); o.k = (2147483648 as number); o.k!	fresh", () => { const o = keep(make()); o.k = E.Zero; o.k ||= (2147483648 as number	not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); for (o.k of [(2147483648	fresh", () => { const o = keep(make()); Reflect.set(make(), "k", (2147483648	out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { value: (2147483648	fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = (2147483648	sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); new Function("o", "v", "o.k = v;")(o, (2147483648	fresh", () => { const o = keep(make()); try { throw 1; } catch {} finally { o.k = (2147483648	prototype", () => { const o = keep(make()); below = Object.create(o); o.a = (2147483648	fresh", () => { const o = keep(make()); o.a = (2147483648 as number); o.k = (2147483648 as number); o.b = (2147483648
fields-of-narrow-types/sample-enum-plain-class-constructor-min-plus-2.ts		: K; k: K; b: K; constructor(k		7	neighbors-out-of-slot", () => { const o: H = keep(new H((-2147483646 as number))); (o as any).a = half; (o as any).b = half	neighbors-out-of-slot", () => { const o: H = keep({ ...make(), k: (-2147483646 as number) }); (o as any).a = half; (o as any).b = half	neighbors-out-of-slot", () => { const s = make(); s.k = (-2147483646 as number); const o: H = keep({ ...s }); (o as any).a = half; (o as any).b = half	fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (-2147483646 as any) }) as H)	fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (-2147483646 as any) }))	fresh", () => { const s = make(); s.k = (-2147483646 as number); const o = keep(Object.assign({}, s) as H)	through-text", () => { const s = make(); s.k = (-2147483646 as number); const { ...o } = s; keep(o); unseen("o => { o.k; return Object.keys(o); }")(o)	through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = (-2147483646	fresh", () => { const o = keep(make()); put(o, (-2147483646	local", () => { const o = (make()); o.k = (-2147483646 as number); note(++o.k); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k	fresh", () => { const o = keep(make()); o.k /= -2147483646	fresh", () => { const o = keep(make()); o.k ^= -2147483646	fresh", () => { const o = keep(make()); o.k = (-2147483646 as number); o.k	sealed", () => { const o = keep(make()); Object.seal(o); o.k = E.Zero; o.k ||= (-2147483646 as number	fresh", () => { const o = keep(make()); for (o.k of [(-2147483646	deleted", () => { const o = keep(make()); delete (o as any).k; Reflect.set(make(), "k", (-2147483646	fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (-2147483646	out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = (-2147483646	fresh", () => { const o = keep(make()); new Function("o", "v", "o.k = v;")(o, (-2147483646	neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; try { throw 1; } catch {} finally { o.k = (-2147483646	fresh", () => { const o = keep(make()); o.a = (-2147483646	through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.a = (-2147483646 as number); o.k = (-2147483646 as number); o.b = (-2147483646
fields-of-narrow-types/sample-enum-plain-class-constructor-minus-half.ts		: K; k: K; b: K; constructor(k		17	deleted", () => { const o: H = keep(new H((-0.5 as number))); delete (o as any).k	deleted", () => { const o: H = keep({ ...make(), k: (-0.5 as number) }); delete (o as any).k	deleted", () => { const s = make(); s.k = (-0.5 as number); const o: H = keep({ ...s }); delete (o as any).k	fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (-0.5 as any) }) as H)	fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (-0.5 as any) }))	fresh", () => { const s = make(); s.k = (-0.5 as number); const o = keep(Object.assign({}, s) as H)	out-and-back", () => { const s = make(); s.k = (-0.5 as number); const { ...o } = s; keep(o); (o as any).k = half; o.k = E.Two	out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.k = (-0.5	fresh", () => { const o = keep(make()); put(o, (-0.5	neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = (-0.5 as number); note(++o.k	fresh", () => { const o = keep(make()); o.k /= -0.5	through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k ^= -0.5	fresh", () => { const o = keep(make()); o.k = (-0.5 as number); o.k	local", () => { const o = (make()); o.k = E.Zero; o.k ||= (-0.5 as number); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k	fresh", () => { const o = keep(make()); for (o.k of [(-0.5	fresh", () => { const o = keep(make()); Reflect.set(make(), "k", (-0.5	fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (-0.5	sealed", () => { const o = keep(make()); Object.seal(o); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = (-0.5	fresh", () => { const o = keep(make()); new Function("o", "v", "o.k = v;")(o, (-0.5	deleted", () => { const o = keep(make()); delete (o as any).k; try { throw 1; } catch {} finally { o.k = (-0.5	fresh", () => { const o = keep(make()); o.a = (-0.5	out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.a = (-0.5 as number); o.k = (-0.5 as number); o.b = (-0.5`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
        w,
        x,
        y,
        z,
        a0,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
${a}enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { a${b}: K) { this.a = E.Seven; this.k = k; this.b = E.Nine; } }
function make(): H { return new H(E.One); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k${c}++; }
function down(o: H): void { o.k${c}--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${d}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${e}; });
await t("spread-later-name ${f}; });
await t("spread-source ${g}; });
await t("assign-fresh-literal ${h}; });
await t("assign-typed-literal ${i}; });
await t("assign-into-empty ${j}; });
await t("rest ${k}; });
await t("typed-store ${l} as number); });
await t("in-a-function ${m} as number)); });
await t("prefix-increment ${o}); });
await t("divide ${p}; });
await t("xor ${q}; });
await t("multiply-the-value ${r} *= 2; });
await t("or-assign ${s}); });
await t("for-of ${t} as number)]); });
await t("reflect-set-receiver ${u} as any), o); });
await t("define-hidden ${v} as any), enumerable: false }); });
await t("setter-above ${w} as number); });
await t("function-constructor ${x} as any)); });
await t("finally ${y} as number); } });
await t("copy-neighbor ${z} as number); o.k = o.a; o.b = o.k; });
await t("all-three ${a0} as number); });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-const-enum-plain-constructor-function-false.ts	35	fresh", () => { const o: H = keep(new HC((false as any))	fresh", () => { const o: H = keep({ ...make(), k: (false as any) }	spread-small-source fresh", () => { const o: H = keep({ ...make(), ...{ k: (false as any) } }	fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (false as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (false as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (false as any)], ["b", E.Nine]]) as unknown as H	typed-store frozen", () => { const o = keep(make()); Object.freeze(o); o.k = (false as any	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (false as any))	postfix-decrement-value not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = (false as any); note(o.k--)	remainder fresh", () => { const o = keep(make()); o.k = E.Seven; o.k %= (false as any)	left out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k <<= (false as any)	negate-the-value fresh", () => { const o = keep(make()); o.k = (false as any); o.k = -o.k as K	and-assign sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k &&= (false as any)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (false as any) }	reflect-set-empty-target prototype", () => { const o = keep(make()); below = Object.create(o); Reflect.set({}, "k", (false as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (false as any) }	setter-on-the-prototype late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (false as any); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(false as any)].forEach(x => { o.k = x	swap fresh", () => { const o = keep(make()); o.a = (false as any); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? E.One : (false as any)
fields-of-narrow-types/sample-const-enum-plain-constructor-function-max.ts	3	prototype", () => { const o: H = keep(new HC((2147483647 as number))); below = Object.create(o	prototype", () => { const o: H = keep({ ...make(), k: (2147483647 as number) }); below = Object.create(o	assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (2147483647 as any) }) as H	typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (2147483647 as any) })	structured-clone late-fields", () => { const s = make(); (s as any).k = (2147483647 as any); const o: H = keep(structuredClone(s)); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i	typed-store late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (2147483647 as number	computed-name fresh", () => { const o = keep(make()); (o as any)[key] = (2147483647 as any	crement fresh", () => { const o = keep(make()); o.k = (2147483647 as number); o.k++	subtract fresh", () => { const o = keep(make()); o.k -= 2147483647	or frozen", () => { const o = keep(make()); Object.freeze(o); o.k |= 2147483647	right-unsigned fresh", () => { const o = keep(make()); o.k = E.Low; o.k >>>= 2147483647	halve-the-value not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); o.k = (2147483647 as number); o.k /= 2	destructure-array fresh", () => { const o = keep(make()); [o.k] = [(2147483647 as number)]	-wider-layout out-of-slot", () => { const o = keep(make()); (o as any).k = half; const s: Wide = { a: 7, k: (2147483647 as number), b: 9 }; Object.assign(o, s	define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true, enumerable: true, configurable: true }	getter-then-value sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: (2147483647 as any), writable: true	proxy-above-with-a-trap fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = (2147483647 as number);	replace prototype", () => { const o = keep(make()); below = Object.create(o); "a".replace("a", () => { o.k = (2147483647 as number); return ""	copy-same-type fresh", () => { const o = keep(make()); const s = make(); s.k = (2147483647 as number); o.k = s.k	back-to-an-integer late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (2147483647 as number); o.k = E.Two
fields-of-narrow-types/sample-const-enum-plain-constructor-function-two-to-53.ts	15	sealed-out-of-slot", () => { const o: H = keep(new HC((9007199254740992 as number))); (o as any).k = half; Object.seal(o	sealed-out-of-slot", () => { const o: H = keep({ ...make(), k: (9007199254740992 as number) }); (o as any).k = half; Object.seal(o	spread-small-source sealed-out-of-slot", () => { const o: H = keep({ ...make(), ...{ k: (9007199254740992 as number) } }); (o as any).k = half; Object.seal(o	fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (9007199254740992 as any) }) as H	assign-typed-literal fresh", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (9007199254740992 as any) }))	from-entries fresh", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (9007199254740992 as any)], ["b", E.Nine]]) as unknown as H	typed-store prototype", () => { const o = keep(make()); below = Object.create(o); o.k = (9007199254740992 as number	-an-untyped-function fresh", () => { const o = keep(make()); putAny(o, (9007199254740992 as any))	postfix-decrement-value late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (9007199254740992 as number); note(o.k--)	remainder fresh", () => { const o = keep(make()); o.k = E.Seven; o.k %= 9007199254740992	left fresh", () => { const o = keep(make()); o.k <<= 9007199254740992	negate-the-value fresh", () => { const o = keep(make()); o.k = (9007199254740992 as number); o.k = -o.k as K	and-assign frozen", () => { const o = keep(make()); Object.freeze(o); o.k &&= (9007199254740992 as number)	 fresh", () => { const o = keep(make()); Object.assign(o, { k: (9007199254740992 as any) }	reflect-set-empty-target not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Reflect.set({}, "k", (9007199254740992 as any), o	define-properties fresh", () => { const o = keep(make()); Object.defineProperties(o, { k: { value: (9007199254740992 as any) }	setter-on-the-prototype out-of-slot", () => { const o = keep(make()); (o as any).k = half; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = (9007199254740992 as number); } finally { delete above.k; }	for-each fresh", () => { const o = keep(make()); [(9007199254740992 as number)].forEach(x => { o.k = x	swap sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.a = (9007199254740992 as number); const x = o.a; o.a = o.k; o.k = x	conditional fresh", () => { const o = keep(make()); o.k = never ? E.One : (9007199254740992 as number)`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
        o,
        p,
        q,
        r,
        s,
        t,
        u,
        v,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
const enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface H { a: K; k: K; b: K; }
function HF(this: H, k: K) { this.a = E.Seven; this.k = k; this.b = E.Nine; }
const HC = HF as unknown as new (k: K) => H;
function make(): H { return new HC(E.One); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k++; }
function down(o: H): void { o.k--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${a}, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial ${b}); });
await t("spread-later-name ${c}); });
await t("${d}); });
await t("assign-${e}); });
await t("${f}; });
await t("${g}); });
await t("${h}); });
await t("in${i}; });
await t("${j}; });
await t("${k}; });
await t("shift-${l}; });
await t("${m}; });
await t("${o}; });
await t("assign${p}); });
await t("${q}); });
await t("${r} }); });
await t("${s} });
await t("${t}; }); });
await t("${u}; });
await t("${v}; });
`,
    ),
    ...family(
      `fields-of-narrow-types/sample-enum-plain-interface-literal-large.ts	2	1e21	frozen", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (1e21 as any) }) as H); Object.freeze(o)	frozen", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (1e21 as any) })); Object.freeze(o)	frozen", () => { const s = make(); s.k = (1e21 as number); const o = keep(Object.assign({}, s) as H); Object.freeze(o)	not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); put(o, (1e21	out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.k /= 1e21	sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = (1e21	prototype", () => { const o = keep(make()); below = Object.create(o); for (o.k of [(1e21	late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; Object.defineProperty(o, "k", { value: (1e21	fresh", () => { const o = keep(make()); new Function("o", "v", "o.k = v;")(o, (1e21	frozen", () => { const o = keep(make()); Object.freeze(o); o.a = (1e21	1e21 as number); o.k = (1e21 as number); o.b = (1e21
fields-of-narrow-types/sample-enum-plain-interface-literal-minus-one.ts		-1	prototype", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (-1 as any) }) as H); below = Object.create(o)	prototype", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (-1 as any) })); below = Object.create(o)	prototype", () => { const s = make(); s.k = (-1 as number); const o = keep(Object.assign({}, s) as H); below = Object.create(o)	late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; put(o, (-1	fresh", () => { const o = keep(make()); o.k /= -1	frozen", () => { const o = keep(make()); Object.freeze(o); o.k = (-1	not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); for (o.k of [(-1	out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { value: (-1	sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); new Function("o", "v", "o.k = v;")(o, (-1	prototype", () => { const o = keep(make()); below = Object.create(o); o.a = (-1	-1 as number); o.k = (-1 as number); o.b = (-1
fields-of-narrow-types/sample-enum-plain-interface-literal-two-to-31.ts	1	2147483648	out-of-slot", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (2147483648 as any) }) as H); (o as any).k = half	out-of-slot", () => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: (2147483648 as any) })); (o as any).k = half	out-of-slot", () => { const s = make(); s.k = (2147483648 as number); const o = keep(Object.assign({}, s) as H); (o as any).k = half	sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); put(o, (2147483648	prototype", () => { const o = keep(make()); below = Object.create(o); o.k /= 2147483648	late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = (2147483648	fresh", () => { const o = keep(make()); for (o.k of [(2147483648	frozen", () => { const o = keep(make()); Object.freeze(o); Object.defineProperty(o, "k", { value: (2147483648	not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); new Function("o", "v", "o.k = v;")(o, (2147483648	out-of-slot", () => { const o = keep(make()); (o as any).k = half; o.a = (2147483648	2147483648 as number); o.k = (2147483648 as number); o.b = (2147483648`,
      (
        a,
        b,
        c,
        d,
        e,
        f,
        g,
        h,
        i,
        j,
        k,
        l,
        m,
      ) => `// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface H { a: K; k: K; b: K; }
function make(): H { return { a: E.Seven, k: E.One, b: E.Nine }; }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\\"a\\":7,\\"k\\":0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483647,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483646,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483645,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483644,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483643,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483642,\\"b\\":9}", "{\\"a\\":7,\\"k\\":2147483648,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-2147483649,\\"b\\":9}", "{\\"a\\":7,\\"k\\":4294967296,\\"b\\":9}", "{\\"a\\":7,\\"k\\":9007199254740992,\\"b\\":9}", "{\\"a\\":7,\\"k\\":0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0.5,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-0,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":-1e999,\\"b\\":9}", "{\\"a\\":7,\\"k\\":1e21,\\"b\\":9}", "{\\"a\\":7,\\"k\\":5e-324,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":null,\\"b\\":9}", "{\\"a\\":7,\\"k\\":true,\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"1\\",\\"b\\":9}", "{\\"a\\":7,\\"k\\":\\"\\",\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":{},\\"b\\":9}", "{\\"a\\":7,\\"k\\":[2],\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}", "{\\"a\\":7,\\"k\\":false,\\"b\\":9}", "{\\"a\\":7,\\"b\\":9}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { o.k++; }
function down(o: H): void { o.k--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : ${a}2, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial fresh", () => { const o: H = keep({ a: E.Seven, k: (${b} as number), b: E.Nine }); });
await t("spread-later-name fresh", () => { const o: H = keep({ ...make(), k: (${b} as number) }); });
await t("spread-source fresh", () => { const s = make(); s.k = (${b} as number); const o: H = keep({ ...s }); });
await t("assign-fresh-literal ${c}; });
await t("assign-typed-literal ${d}; });
await t("assign-into-empty ${e}; });
await t("rest fresh", () => { const s = make(); s.k = (${b} as number); const { ...o } = s; keep(o); });
await t("typed-store fresh", () => { const o = keep(make()); o.k = (${b} as number); });
await t("in-a-function ${f} as number)); });
await t("prefix-increment fresh", () => { const o = keep(make()); o.k = (${b} as number); note(++o.k); });
await t("divide ${g}; });
await t("xor fresh", () => { const o = keep(make()); o.k ^= ${b}; });
await t("multiply-the-value ${h} as number); o.k *= 2; });
await t("or-assign fresh", () => { const o = keep(make()); o.k = E.Zero; o.k ||= (${b} as number); });
await t("for-of ${i} as number)]); });
await t("reflect-set-receiver fresh", () => { const o = keep(make()); Reflect.set(make(), "k", (${b} as any), o); });
await t("define-hidden ${j} as any), enumerable: false }); });
await t("setter-above fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = (${b} as number); });
await t("function-constructor ${k} as any)); });
await t("finally fresh", () => { const o = keep(make()); try { throw 1; } catch {} finally { o.k = (${b} as number); } });
await t("copy-neighbor ${l} as number); o.k = o.a; o.b = o.k; });
await t("all-three fresh", () => { const o = keep(make()); o.a = (${m} as number); });
`,
    ),
    ...family(
      `impostors-narrowing-and-accessors/wg-probes-ice-1.ts	ver a class", (h, between) => (isSquare(h.shape) ? (between(h), [h.shape.edge, h.shape.edge * 2, h.shape.sides
impostors-narrowing-and-accessors/wg-probes-ice-2.ts	ver a number", (h, between) => (isNumber(h.value) ? (between(h), [h.value, h.value + 1, h.value * 2
impostors-narrowing-and-accessors/wg-probes-ice-3.ts	n this", (h, between) => (h.shape.isSquare() ? (between(h), [h.shape.edge, h.shape.edge * 2, h.shape.sides
impostors-narrowing-and-accessors/wg-probes-ice-4.ts	n this about a member", (h, between) => (h.holdsANumber() ? (between(h), [h.value, h.value + 1, h.value * 2`,
      a => `// Impostors narrowing and accessors: wg probes ice. It prints what plain Bun prints.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Shape {
  sides = 4;
  isSquare(): this is Square {
    return this instanceof Square;
  }
}

class Square extends Shape {
  edge = 2;
}

class Circle extends Shape {
  radius = 5;
}

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
  holdsANumber(): this is Holder & { value: number } {
    return typeof this.value === "number";
  }
}

function isSquare(s: Shape): s is Square {
  return s instanceof Square;
}

function isNumber(v: number | string): v is number {
  return typeof v === "number";
}

function mustBeSquare(s: Shape): asserts s is Square {
  if (!(s instanceof Square)) throw new RangeError("not a square");
}

function mustBeNumber(v: number | string): asserts v is number {
  if (typeof v !== "number") throw new RangeError("not a number");
}

function mustHold(condition: boolean): asserts condition {
  if (!condition) throw new RangeError("does not hold");
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const toBase: Between = h => {
  h.shape = new Shape();
  h.value = "text";
};
const toSibling: Between = h => {
  h.shape = new Circle();
  h.value = "";
};

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["a guard o${a}]) : "other")],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder(), keep);
round("the base class and a string", toBase);
round("a sibling and an empty string", toSibling);
round("honest again", keep);
`,
    ),
    ...family(
      `members-of-process/launder-als.js	als	(() => { const { AsyncLocalStorage } = require("node:async_hooks"); const s = new AsyncLocalStorage(); return s.run(process, () => s.getStore()); })()
members-of-process/launder-array-from.js	array from	Array.from([process])[0]
members-of-process/launder-computed-global.js	computed global	globalThis[["pro", "cess"].join("")]
members-of-process/launder-emitter-this.js	emitter this	(() => { let found; process.once("warning", function () { found = this; }); process.emit("warning", {}); return found; })()
members-of-process/launder-get-builtin.js	get builtin	process.getBuiltinModule("node:process")
members-of-process/launder-iterator.js	iterator	[process].values().next().value
members-of-process/launder-json-reviver.js	json reviver	JSON.parse("[0]", (key, value) => (key === "0" ? process : value))[0]
members-of-process/launder-proxy.js	proxy	new Proxy({}, { get: () => process }).anything
members-of-process/launder-reflect-get.js	reflect get	Reflect.get(globalThis, "process")
members-of-process/launder-sort.js	sort	[process, process].sort(() => 0)[1]
members-of-process/launder-structured.js	structured	[process].at(Number(process.env.CHILD_WITH_CHANNEL) - 1)
members-of-process/launder-symbol-key.js	symbol key	({ [Symbol.for(process.env.CHILD_WITH_CHANNEL)]: process })[Symbol.for("1")]
members-of-process/launder-weakref.js	weakref	new WeakRef(process).deref()`,
      (a, b) => `// Members of process: launder ${a}. It prints what plain Bun prints.
const startedFromExecutable = /[$~]bun/i.test(process.argv[1]);
if (process.env.CHILD_WITH_CHANNEL) {
  const self = ${b};
  self.on("message", message => {
    self.send({ answered: message });
    self.disconnect();
  });
} else {
  const received = [];
  const child = Bun.spawn({
    cmd: startedFromExecutable ? [process.execPath] : [process.execPath, process.argv[1]],
    env: { ...process.env, CHILD_WITH_CHANNEL: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ipc(message) { received.push(message); },
  });
  child.send("first");
  const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  console.log(JSON.stringify(received), output.trim(), errors.trim().split("\\n").filter(line => /error/i.test(line)).join(" | "), exitCode);
}
`,
    ),
    ...family(
      `native-members-of-requests/rank-1350-model-assign-elsewhere.js	{ routesById: tree, routesByPath: tree }	.cache
native-members-of-requests/rank-1350-model-assign-unknown.js	globalThis.CACHE ?? (globalThis.CACHE = { ...tree, routesById: tree, routesByPath: tree })	
native-members-of-requests/rank-1350-model-assign.js	{ routesById: tree, routesByPath: tree }	`,
      (
        a,
        b,
      ) => `// A class whose constructor makes a function that closes over \`this\`, and calls it: the function creates fields of the object that is being made.
class Router {
  constructor(options) {
    this.key = "k" + options.id;
    this.subscribers = new Set();
    this.cache = new Map();
    this.update = newOptions => {
      const previous = this.options;
      this.options = newOptions;
      this.isServer = newOptions.isServer ?? previous === undefined;
      this.origin = newOptions.origin;
      if (!this.origin) this.origin = "http://localhost";
      const basepath = newOptions.basepath ?? "/";
      if (this.basepath !== basepath) {
        this.basepath = basepath;
        this.rewrite = basepath !== "/" ? basepath : undefined;
      }
      if (newOptions.tree !== this.tree) {
        this.tree = newOptions.tree;
        this.setRoutes(${a});
      }
      if (!this.stores) {
        this.batch = newOptions.id;
        this.stores = [newOptions.id];
      }
    };
    this.describe = () => this.key + this.origin + this.basepath + this.batch + this.stores.length + this.isServer + (this.tree === this.options.tree);
    this.update(options);
  }
  setRoutes(caches) {
    Object.assign(this${b}, caches);
    this.lightweight = new WeakMap();
  }
}
const tree = { id: 0 };
const rounds = Number(process.argv[2] ?? 3);
let length = 0;
for (let round = 0; round < rounds; round++) {
  const router = new Router({ id: round, tree, origin: round & 1 ? "http://a" : undefined });
  if (round % 3 === 0) router.update({ id: round + 1, tree, basepath: "/b" });
  length += router.describe().length;
}
console.log(length);
`,
    ),
    ...family(
      `reads-by-name/mf-2.js	Base.prototype.second = function () { return 1; }
reads-by-name/mf-3.js	Middle.prototype.second = function () { return 1; }
reads-by-name/mf-4.js	delete Middle.prototype.second
reads-by-name/mf-5.js	Object.defineProperty(Base.prototype, "second", { get() { return 1; }, configurable: true })`,
      a => `// A read by name on an instance can answer with a method or an accessor of its class, or of a class above, without a walk, and with undefined for a name that none of them declares.
// Each round reads often enough to fill whatever remembers the answer. Between the rounds a prototype object, the chain, or one instance changes.
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }

class Base {
  constructor(value) { this.value = value; }
  first() { return "Base.first " + this.value; }
  second() { return "Base.second " + this.value; }
  get size() { return "Base.size " + this.value; }
  set size(value) { this.value = "set by Base " + value; }
  get readOnly() { return "Base.readOnly"; }
  set writeOnly(value) { this.value = "writeOnly " + value; }
  static make(value) { return new this(value); }
}
class Middle extends Base {
  second() { return "Middle.second " + this.value; }
  third() { return "Middle.third then " + super.second(); }
}
class Leaf extends Middle {
  constructor(value) { super(value); this.own = "own " + value; }
  get size() { return "Leaf.size then " + super.size; }
}
class Alone { method() { return "Alone.method"; } }
class Empty {}

const instances = [new Base(0), new Middle(1), new Leaf(2), new Alone(), new Empty(), Base.make(5), Leaf.make(6)];

function read(o) {
  return typeof o.first + "," + typeof o.second + "," + typeof o.third + "," + o.size + "," + o.readOnly + "," + o.writeOnly + "," + o.missing + "," + o.own + "," + o.value + "," + typeof o.make + "," + o.constructor.name;
}
function call(o) { return o.first() + ";" + o.second() + ";" + o.third(); }
function ask(o) {
  return ("second" in o) + "," + Object.hasOwn(o, "second") + "," + ("size" in o) + "," + Object.hasOwn(o, "size") + "," + ("missing" in o) + "," + o.hasOwnProperty("value");
}
function same(o) { return (o.second === Object.getPrototypeOf(o).second) + "," + (o.second === Base.prototype.second) + "," + (o.constructor === Object.getPrototypeOf(o).constructor); }
function store(o, i) { o.size = i; return o.value; }

function round(label) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    last = "";
    for (const instance of instances) {
      const o = hidden(instance);
      last += "\\n  " + attempt(() => read(o)) + " | " + attempt(() => call(o)) + " | " + attempt(() => ask(o)) + " | " + attempt(() => same(o)) + " | " + attempt(() => Object.keys(o));
    }
  }
  console.log(label + ":" + last);
}

round("start");
if (process.argv.length > 99) { ${a}; }
`,
    ),
    ...family(
      `reads-by-name/one-14.js	Base.prototype, "first", { configurable: true, get() { return () => "first by a getter " + this.value; }
reads-by-name/one-16.js	Base.prototype, "size", { configurable: true, writable: true, value: "size is a value"
reads-by-name/one-18.js	Base.prototype, "readOnly", { configurable: true, get() { return "another getter"; }
reads-by-name/one-26.js	instances[2], "third", { configurable: true, get() { return () => "own getter for third"; }`,
      a => `// A read by name on an instance can answer with a method or an accessor of its class, or of a class above, without a walk, and with undefined for a name that none of them declares.
// Each round reads often enough to fill whatever remembers the answer. Between the rounds a prototype object, the chain, or one instance changes.
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }

class Base {
  constructor(value) { this.value = value; }
  first() { return "Base.first " + this.value; }
  second() { return "Base.second " + this.value; }
  get size() { return "Base.size " + this.value; }
  set size(value) { this.value = "set by Base " + value; }
  get readOnly() { return "Base.readOnly"; }
  set writeOnly(value) { this.value = "writeOnly " + value; }
  static make(value) { return new this(value); }
}
class Middle extends Base {
  second() { return "Middle.second " + this.value; }
  third() { return "Middle.third then " + super.second(); }
}
class Leaf extends Middle {
  constructor(value) { super(value); this.own = "own " + value; }
  get size() { return "Leaf.size then " + super.size; }
}
class Alone { method() { return "Alone.method"; } }
class Empty {}

const instances = [new Base(0), new Middle(1), new Leaf(2), new Alone(), new Empty(), Base.make(5), Leaf.make(6)];

function read(o) {
  return typeof o.first + "," + typeof o.second + "," + typeof o.third + "," + o.size + "," + o.readOnly + "," + o.writeOnly + "," + o.missing + "," + o.own + "," + o.value + "," + typeof o.make + "," + o.constructor.name;
}
function call(o) { return o.first() + ";" + o.second() + ";" + o.third(); }
function ask(o) {
  return ("second" in o) + "," + Object.hasOwn(o, "second") + "," + ("size" in o) + "," + Object.hasOwn(o, "size") + "," + ("missing" in o) + "," + o.hasOwnProperty("value");
}
function same(o) { return (o.second === Object.getPrototypeOf(o).second) + "," + (o.second === Base.prototype.second) + "," + (o.constructor === Object.getPrototypeOf(o).constructor); }
function store(o, i) { o.size = i; return o.value; }

function round(label) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    last = "";
    for (const instance of instances) {
      const o = hidden(instance);
      last += "\\n  " + attempt(() => read(o)) + " | " + attempt(() => call(o)) + " | " + attempt(() => ask(o)) + " | " + attempt(() => same(o)) + " | " + attempt(() => Object.keys(o));
    }
  }
  console.log(label + ":" + last);
}

round("start");
if (process.argv.length > 99) {
Object.defineProperty(${a} });
}
`,
    ),
    ...family(
      `the-environment-of-the-process/env3.ts	, one probe of many	(globalThis as any)[process.argv[9]] = JSON.parse(process.argv[10]);
the-environment-of-the-process/o-assign.ts	: o assign	{ Object.assign(globalThis, JSON.parse(process.argv[9])); }
the-environment-of-the-process/o-callee.ts	: o callee	{ (globalThis as any)[process.argv[9]] = (JSON.parse(process.argv[10]) as any).f(); }
the-environment-of-the-process/o-define.ts	: o define	{ Object.defineProperty(globalThis, process.argv[9], JSON.parse(process.argv[10])); }
the-environment-of-the-process/o-escape.ts	: o escape	{ (JSON.parse(process.argv[10]) as any).f(globalThis); }
the-environment-of-the-process/o-eval.ts	: o eval	{ (0, eval)(process.argv[9]); }
the-environment-of-the-process/o-function.ts	: o function	{ new Function(process.argv[9])(); }
the-environment-of-the-process/o-import.ts	: o import	{ await import(process.argv[9]); }
the-environment-of-the-process/o-require.ts	: o require	{ require(process.argv[9]); }
the-environment-of-the-process/o-vm.ts	: o vm	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); }
the-environment-of-the-process/o-write.ts	: o write	{ (globalThis as any).process = JSON.parse(process.argv[9]); }
the-environment-of-the-process/p-vm-assign.ts	: p vm assign	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); Object.assign(globalThis, (JSON.parse(process.argv[10]) as any).f()); }
the-environment-of-the-process/p-vm-callee.ts	: p vm callee	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); (globalThis as any)[process.argv[9]] = (JSON.parse(process.argv[10]) as any).f(); }
the-environment-of-the-process/p-vm-key.ts	: p vm key	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); (globalThis as any)[process.argv[9]] = JSON.parse(process.argv[10]); }
the-environment-of-the-process/p-vm-write.ts	: p vm write	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); (globalThis as any).process = JSON.parse(process.argv[9]); }
the-environment-of-the-process/q-all.ts	: q all	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); (globalThis as any)[process.argv[9]] = (JSON.parse(process.argv[10]) as any).f(process, globalThis); (process as any)[process.argv[9]] = 1; }
the-environment-of-the-process/q-env-write.ts	: q env write	{ (process as any).env = JSON.parse(process.argv[9]); }
the-environment-of-the-process/q-escape.ts	: q escape	{ (JSON.parse(process.argv[10]) as any).f(process); }
the-environment-of-the-process/q-key-write.ts	: q key write	{ (process as any)[process.argv[9]] = JSON.parse(process.argv[10]); }
the-environment-of-the-process/q-vm-env-write.ts	: q vm env write	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); (process as any).env = JSON.parse(process.argv[9]); }
the-environment-of-the-process/q-vm-escape.ts	: q vm escape	{ new (require("node:vm").Script)(process.argv[9]).runInThisContext(); (JSON.parse(process.argv[10]) as any).f(process); }`,
      (a, b) => `// The environment of the process${a}. It prints what plain Bun prints.
function getterFor(key: string, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = process.env[key];
    if (raw !== lastRaw) {
      lastParsed = raw === undefined ? 0 : raw.length;
      lastRaw = raw;
    }
    return lastParsed;
  };
}
const names = ["HOME", "PATH", "NOT_THERE_AT_ALL", "USER", "TERM", "ALSO_MISSING", "LANG", "SHELL"];
const getters = names.map(name => getterFor(name, names));
const rounds = Number(process.argv[2] ?? 200000);
if (process.argv.length > 99) ${b}
let sum = 0;
for (let i = 0; i < rounds; i++) sum += getters[i & 7]() as number;
console.log(sum > 0, rounds);
`,
    ),
    "lists-of-constants/tables-small-s4-different.ts": text(
      `// Lists of constants: tables small  different. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { yrdxhwbsi: 383, dxkmkljgn: 853, cekmwkcrt: 404, bpiwvvuec: 64	1: Record<string, number> = { qzhvjfvzv: 958, whgpilhwy: 479, vmqjtxwpc: 935, rtptthjfc: 531	2: Record<string, number> = { vxwyvfwpp: 18, ohkemptqa: 476, dyrqpzyrr: 584, qufxumqtp: 405	3: Record<string, number> = { avjfmjrcl: 649, pnbkrthqv: 347, ijevbaedj: 962, fugijdqst: 804	4: Record<string, number> = { eyckjwsnt: 796, bmnjhgjmm: 141, iszqbzrlr: 58, tmpdjncap: 181	5: Record<string, number> = { isqlyvicx: 458, nxirgoneq: 56, tazfnutjd: 368, raeczrhna: 5	6: Record<string, number> = { rvaulbnxn: 983, hnjscnmuk: 358, ozemkjfkt: 654, mxnvfbysa: 575	7: Record<string, number> = { njyejxxch: 779, dlbstpcai: 417, mdxkjptho: 444, swdkszyvv: 45	8: Record<string, number> = { mjjvvvsvy: 401, hlpultsvu: 581, prtfipibx: 893, qnwldvvkf: 541	9: Record<string, number> = { lxnyalyfb: 77, roosgdtcv: 967, wrtlvwhqe: 853, xaltxcqgu: 643	10: Record<string, number> = { ysjhozroh: 233, zuzmbvskf: 498, tsrzxgodl: 24, loirwjzjh: 179	11: Record<string, number> = { oahhjcaoy: 4, gihdlxnza: 244, awhuvofhq: 660, slinzbivl: 317
12: Record<string, number> = { qvsfyaynx: 156, zthldyrtg: 521, zzosuyuxs: 129, lvsnoquht: 565	13: Record<string, number> = { gurmbepqv: 973, ofnheapgf: 15, bbhyfwboi: 898, lxxqlafba: 463	14: Record<string, number> = { flyfnrtzx: 637, bdpynpsvw: 345, gypdrhthw: 601, rghanshjk: 371	15: Record<string, number> = { atgjhzpnu: 742, aiurmfrpk: 75, qsvapwmwc: 661, arjjxobin: 66	16: Record<string, number> = { qeqoxiwvt: 40, tweihwzja: 199, kvowdwikg: 374, fggmvzaox: 901	17: Record<string, number> = { ocrmhcaud: 939, clioytmsw: 838, shjlmxsud: 326, dmezilcke: 900	18: Record<string, number> = { uovsleouq: 552, pmlbgixbg: 714, komoffhtb: 959, bprlpcnxh: 890	19: Record<string, number> = { tuqjkxibz: 184, rppghvppl: 36, ajmeuvxej: 220, jiqupojed: 698	20: Record<string, number> = { mvkzmmdxn: 38, crqhtdnpi: 76, ojvrfqrzo: 272, zbtwwadrl: 149	21: Record<string, number> = { nivoxxozm: 396, bnkjnuhgt: 688, fxzzrvdnv: 649, rbsgkbjmo: 633	22: Record<string, number> = { hqdwayqvl: 936, hnvmsiucu: 911, jxniijocd: 665, wnovqzzge: 354	23: Record<string, number> = { hqddejzhz: 310, qrqrjshkz: 337, mphqmbufw: 130, pvwpswhcw: 476
24: Record<string, number> = { bxwrbjlpo: 528, bqzptrgln: 67, gwneyuwiy: 840, pylqpuuuq: 215	25: Record<string, number> = { lxkcgmyuh: 856, mqehmdoui: 261, morskaerp: 870, rkfocfzlh: 478	26: Record<string, number> = { bmbrnsdwx: 369, cgvssgepy: 244, bxhckorch: 871, iuitwzxra: 929	27: Record<string, number> = { fhkyeuobo: 938, goqvtagay: 713, avbjumkzn: 281, skwsswoea: 166	28: Record<string, number> = { vcsfjlqqn: 22, lvldhasgy: 674, dvnkayxlh: 573, xvrosswyg: 731	29: Record<string, number> = { nfniueruy: 977, acwzwmxmu: 722, szkpdhahx: 84, xkplcbjko: 885	30: Record<string, number> = { zbqpbhoik: 618, nhiukzsdu: 202, rvhlkfmiv: 477, ioxmiqgoq: 422	31: Record<string, number> = { ilbuuhjop: 74, yrtthefbe: 803, hmitiqgfs: 487, eibieqztv: 495	32: Record<string, number> = { iumozdpyi: 78, gfurfmgkt: 43, uskyulucm: 418, tsqryrfbz: 776	33: Record<string, number> = { vdpsdqxzt: 434, uihjrhhck: 221, xfneywepp: 199, yyxaqdyns: 995	34: Record<string, number> = { pjnrgxlai: 755, oizsiwwok: 444, evjlmdujo: 451, qrsjffvaf: 473	35: Record<string, number> = { tjgfteoip: 874, lzfbsaqff: 323, ryzpezbsn: 379, rdheoryji: 540
36: Record<string, number> = { aonnoyhch: 214, vxhbmfssc: 343, fjykacjzh: 394, jnqrtxkpv: 225	37: Record<string, number> = { wiaobphwl: 757, cagikffdp: 493, lphbkhywz: 902, dcdhrpbob: 579	38: Record<string, number> = { deqrkhdoq: 951, vsvienoaw: 99, pejshsyrz: 99, qlewzgkro: 624	39: Record<string, number> = { luvdlfqld: 355, qyxrkrhpm: 293, ydserhelh: 946, rdhtlnqau: 526	40: Record<string, number> = { vpnfcpazc: 167, pilcixhof: 800, nfkgaxvmd: 472, bdrojfaiy: 552	41: Record<string, number> = { daizmypri: 675, kuvkuzqpc: 331, zqpssjzxm: 394, vlsisiiml: 458	42: Record<string, number> = { gccfbscqi: 932, njmfhxxso: 571, otorcsiok: 271, plihivxgx: 907	43: Record<string, number> = { azozgndlt: 931, vjbupurfe: 159, lwyaiiboh: 264, oubjdgdvl: 293	44: Record<string, number> = { jfremcziu: 653, aajlgrggs: 827, lsdcesokp: 835, hyqipfbmn: 12	45: Record<string, number> = { qbjsmvynv: 945, upnurzjgz: 541, sthbmsrfu: 404, lfeverhva: 756	46: Record<string, number> = { hoznwiabd: 372, nkgrxbbop: 286, gloqqucst: 615, ixmqbcfyn: 408	47: Record<string, number> = { qknmpjhpv: 689, fzjlwrvwi: 757, hyhoojcgl: 924, pdvilfxsn: 981
48: Record<string, number> = { tysbnbvtd: 902, kaadgxmwp: 107, gsxqtwmwi: 270, qdpxyfrdl: 726	49: Record<string, number> = { uzytttewk: 873, uylxijcnk: 634, ilnkxwlqr: 960, vrhgipmxq: 118	50: Record<string, number> = { apkwizjic: 348, dfhonucmk: 477, qxgwbfvce: 12, dxhtbwear: 35	51: Record<string, number> = { hvwfqxxmn: 681, wmksdnmbz: 79, ujjvhpmlv: 343, kommeywcx: 765	52: Record<string, number> = { pdixuuary: 265, jrpetojmn: 636, brsdqgdmi: 154, cqnlhpxdc: 821	53: Record<string, number> = { xqjiaxmly: 690, oomtqrkiz: 406, ajjofjxxl: 812, qqogwratj: 175	54: Record<string, number> = { dllwnpvek: 369, demxrmwle: 333, pqbfpxqem: 58, yzvyzzyyb: 5	55: Record<string, number> = { prgwaehnz: 220, cjwijgvcd: 690, pmewlwcdp: 254, nnuvwajbt: 788	56: Record<string, number> = { djpvbxwsn: 443, dfhcnlama: 887, avgmuwwlw: 176, mvztrzukj: 358	57: Record<string, number> = { drfnluqwu: 11, waawjjzqq: 646, zhyjdyvps: 12, qyvuuqxim: 462	58: Record<string, number> = { wcceqdvul: 321, luxbsjwun: 135, wnptnewuj: 87, xtdxglbuk: 593	59: Record<string, number> = { kunzdxksg: 268, ljuqmmstf: 31, tjhmjaleo: 740, nuozxkthr: 599
60: Record<string, number> = { bkyktjnfi: 129, ecdoracmo: 36, qaiguyrrj: 348, mzljdwsfb: 266	61: Record<string, number> = { ltjchixsi: 913, hyqazbkxx: 994, gxhgegtrp: 134, jbnrqwtnj: 947	62: Record<string, number> = { pajgqtjnq: 20, wmukqzlpv: 173, dlpapdefc: 530, dudvlpxtr: 619	63: Record<string, number> = { abqxispup: 333, arongcpyw: 195, vtyevkasu: 760, pakiaalvl: 200	64: Record<string, number> = { kodmzeuli: 431, fcbujmjnf: 506, zqykqejoy: 978, psyhcvnuy: 43	65: Record<string, number> = { unqjyfomx: 459, ylywmazgq: 307, stifcocnz: 467, ympilpcor: 758	66: Record<string, number> = { zhjtwkevb: 550, uodqhjxsl: 880, ssmwujora: 197, ukdqcwlrx: 542	67: Record<string, number> = { xdnqrhfpo: 170, jwcdjrnju: 454, unwvznvng: 661, puwmxjiec: 489	68: Record<string, number> = { vkrlyzufj: 291, piqfrqcev: 279, oulxtpjgn: 940, qnbwkzgsp: 601	69: Record<string, number> = { tlhqmcfid: 561, xjuuyslbs: 274, eqgajgtsj: 603, cbzmhywlh: 948	70: Record<string, number> = { fxeelaujd: 466, fsxzvdryh: 877, alhradtuu: 733, uwdmrcqnr: 511	71: Record<string, number> = { pvhwurvgp: 406, ghmcizdta: 536, vpzvebjhe: 901, spvymfehc: 533
72: Record<string, number> = { kytmppxpt: 975, karvbmijd: 171, bvigvlero: 558, neumkggzd: 819	73: Record<string, number> = { nepwjqohd: 135, xeslembhj: 523, pjudbtjou: 727, szipxkhem: 844	74: Record<string, number> = { qaldeqcbk: 522, gzpuzdjdc: 880, vfzpcoqet: 322, ohctignza: 160	75: Record<string, number> = { igagqramc: 52, tmnwqrfug: 38, duhqlbwhv: 788, zqrtjtjxx: 653	76: Record<string, number> = { jqnrhkmtp: 168, kfxqhpfvw: 69, lwywzmdks: 408, ndwwrxlyq: 850	77: Record<string, number> = { kewihpngs: 506, wlokrocco: 189, flcljlczu: 756, qmmkjgnbh: 680	78: Record<string, number> = { bvmbjcogl: 312, ydgdamtof: 233, sjaqrbdbo: 56, qadppibco: 662	79: Record<string, number> = { vbrtqflqf: 240, egieohzie: 791, grpcpqzra: 200, bgzyibzlm: 995	80: Record<string, number> = { wjvyeggsg: 693, kbynsmdpa: 735, bccesohzh: 228, ivdhaolbr: 165	81: Record<string, number> = { iokosuxhz: 750, ttptdqrcg: 603, mhjtjaffv: 507, bhvhzxijl: 122	82: Record<string, number> = { oawqdskxx: 738, xgowntaxf: 902, cmsaboavn: 939, fcppafala: 566	83: Record<string, number> = { qncxlskjf: 951, cwqvkggln: 805, rtbxbtzxc: 374, phfrhosxr: 704
84: Record<string, number> = { jtyflzrhc: 51, otwmjeowy: 84, phgfbsakw: 650, wjyjfpvqc: 291	85: Record<string, number> = { plzyururs: 56, tgbnuuezr: 39, xkuscasnv: 442, kkdoycutl: 432	86: Record<string, number> = { hrtbskxur: 121, lwiqntzlh: 555, hfyhocmyb: 712, muvrcafwm: 456	87: Record<string, number> = { irkqhoocc: 674, zgjvnnbjr: 935, vbvjslcxd: 106, vfqdiljya: 78	88: Record<string, number> = { rwnhloxyx: 466, bodfdzlti: 947, ujclovlac: 459, vpdlnmnlu: 282	89: Record<string, number> = { ngkarbzgl: 344, urdivnwgt: 5, ydwyubfqs: 582, kzngypago: 985	90: Record<string, number> = { iapmmmmqe: 854, vxbudzhvc: 65, gnykrpblx: 22, jhvsrxvlt: 212	91: Record<string, number> = { qknviacmm: 226, bjbpriido: 621, ggfpttzmi: 594, baddfsofy: 566	92: Record<string, number> = { pxmphjxrl: 6, gjqmptrzh: 497, qtrnfjzlh: 281, shfnvupiu: 329	93: Record<string, number> = { zmklotgor: 162, hwqypvpqa: 24, xhgplamuw: 629, zatllzdaq: 98	94: Record<string, number> = { qnzzwoiyw: 474, hyrnipbcv: 911, oezcfixuv: 546, nesjrzaxf: 662	95: Record<string, number> = { dwsqdzvng: 155, vejmyjewt: 483, mteyuaekc: 358, zolncsnve: 589
96: Record<string, number> = { jnkdcitgw: 109, gimewswig: 575, isdjfsioa: 11, tdybyvbov: 658	97: Record<string, number> = { ojgwpataq: 96, quzjonvot: 212, dvacgpfhw: 983, nkmynqnht: 937	98: Record<string, number> = { otnensyvx: 215, bdmxuohjr: 833, bltngbkqn: 428, svpmtvate: 139	99: Record<string, number> = { fmglijobg: 308, bkeavjcwy: 421, oazoywluk: 401, pbksgfdit: 654	100: Record<string, number> = { qqfcpjlfe: 811, jvqhwfxqn: 851, pnyuezval: 164, kukoxddwa: 470	101: Record<string, number> = { oebmmsunb: 353, ghujhwkbo: 780, ifwpocskb: 906, kesgdfxjl: 183	102: Record<string, number> = { onawyfrqt: 721, pqnekeulx: 378, kzztgswme: 215, bdoodkwri: 610	103: Record<string, number> = { yiswzufbz: 751, mcqknhiqm: 607, aohxkihmb: 142, ngylnhros: 217	104: Record<string, number> = { gmgflwbrg: 6, sblprqsto: 73, hlntrxwpg: 569, xncjkmyml: 241	105: Record<string, number> = { yayamrsnl: 757, oycqtjvzp: 882, nwjxgkldr: 686, qxklhuixj: 296	106: Record<string, number> = { lejtqiemr: 482, bhpsgovyx: 418, pkgzegaqq: 221, ykbkkewtu: 388	107: Record<string, number> = { jxgyuyyow: 572, xtkxfmtef: 299, qoevjcxio: 651, kalndhyur: 159
108: Record<string, number> = { wcrmdqmrn: 740, shggmlwnb: 161, ddjswcody: 687, rrpuubsnm: 363	109: Record<string, number> = { nbgfbzghv: 204, itarckitg: 11, skuzngcle: 539, iiphvlnml: 166	110: Record<string, number> = { fmcaqjdub: 277, zpciyjgpl: 115, sptphgwjs: 809, ktkbjkmak: 162	111: Record<string, number> = { bxqjxtbiv: 35, bitlfpblq: 842, drifmwvmc: 677, jpitghyrk: 998	112: Record<string, number> = { hpwbvlsdx: 331, xbitpdjaq: 677, mrlcerzfo: 978, kzipiaymv: 108	113: Record<string, number> = { eeitvhcjc: 370, hijrubxyp: 391, bakshuxsu: 475, iytprbupw: 408	114: Record<string, number> = { jljvkzisp: 18, mkmwqatar: 360, ruqobuppm: 390, tgtjqjouy: 940	115: Record<string, number> = { cxqsnhikk: 109, mnnmwwehs: 312, ehbwdvznq: 93, syvlhowoi: 532	116: Record<string, number> = { fgtnzmkff: 202, xxptpclad: 213, ilwlxaxvl: 616, dnfacvczb: 298	117: Record<string, number> = { keaghxeek: 817, nyztainfw: 661, rulqhlpxc: 732, efqoghdmq: 885	118: Record<string, number> = { rbepsxdbg: 564, omkcjieak: 719, wmygdemue: 37, fsbnckaii: 128	119: Record<string, number> = { kfszolowi: 784, fztloaxyq: 108, arsgckwjp: 242, mozzahuxp: 581
120: Record<string, number> = { ajvpkzxuk: 593, ydppyabgb: 300, dkdnetuwn: 713, rpkhzxeex: 57	121: Record<string, number> = { vonkzyimr: 632, rrhvwwvfo: 661, atwenedoz: 748, bjwpnosbi: 203	122: Record<string, number> = { ldptkxtyi: 68, kkbfsxwov: 484, diphwpnce: 521, vhmsrhupz: 232	123: Record<string, number> = { faylupzpu: 709, ajzaqrxuu: 94, gmskcsmil: 366, xqrpwzvig: 918	124: Record<string, number> = { hljercqen: 514, tmvmrzlbi: 546, qupaixfmk: 915, xhdiediyi: 652	125: Record<string, number> = { sfbnexskp: 442, qdypbdtnf: 977, lkczyqmdx: 672, kqhfijbbw: 75	126: Record<string, number> = { gznumkviq: 990, ckeiybpye: 998, awqkzprcb: 917, wikokcqco: 529	127: Record<string, number> = { miebhjcbk: 815, hhpcqeusx: 105, ksyrglxfb: 538, chcdsidsk: 320	128: Record<string, number> = { zjlmssujh: 473, nmychlsrr: 942, jyqrjpqwe: 879, dvobyggfp: 791	129: Record<string, number> = { sfujbclju: 586, qjjujhqto: 166, wfzgqqwvp: 452, ntabyzidf: 722	130: Record<string, number> = { krtgrkzxe: 644, fgzqsybak: 467, wjfaydweq: 205, ohktpkcao: 261	131: Record<string, number> = { wgevtuqms: 262, ooigwfiqs: 73, bfczirqnj: 715, uedflcofh: 571
132: Record<string, number> = { udkualupv: 401, qsjzgbpvj: 177, wpewfmjpk: 229, toxlvxdcj: 931	133: Record<string, number> = { gjqgisyqr: 267, vtylwuowd: 656, vqyypyyhk: 689, sluocjnji: 260	134: Record<string, number> = { woligpnva: 497, cqqjhjysm: 184, ancvwoall: 795, hctzkyukh: 386	135: Record<string, number> = { mhtwqevey: 450, gnneewnbs: 950, mwonvvjif: 606, kkfogjshk: 492	136: Record<string, number> = { ekzujelmi: 31, pypjvooip: 983, ijrzzvlwc: 409, fzgckttjg: 145	137: Record<string, number> = { vsrdxwwyx: 404, kizhfoyly: 700, ttmiagfls: 63, ionyabgjh: 352	138: Record<string, number> = { aoluyhscm: 939, yjwmvamps: 341, zjnabhoto: 161, jetxskjnb: 268	139: Record<string, number> = { zyaxpfmjf: 423, gomkmityf: 630, zftfyuzxb: 175, nuuhqsjjc: 872	140: Record<string, number> = { abheeglfg: 907, hqkkwsdwy: 472, biuweixls: 556, ezuxbbtvv: 155	141: Record<string, number> = { sjvopoczb: 353, socvjddsq: 251, ecenxnxrc: 436, phcpduvgu: 426	142: Record<string, number> = { zaovjvepd: 407, rgbjpribu: 954, otrsznnso: 676, urgtihqhu: 385	143: Record<string, number> = { drwpbwdgn: 997, xepwzjxyx: 927, pnkdgblbm: 138, muceiuxlg: 24
144: Record<string, number> = { mweopnqui: 803, jjfzxhvla: 990, zymemmpdq: 547, mrvefmknp: 313	145: Record<string, number> = { xmegyxvrr: 568, nwhonkpia: 458, engfojrvz: 439, nnvvooanl: 743	146: Record<string, number> = { nuxjvoyhe: 963, uakledida: 416, tvsukayal: 331, ttgnkbhwb: 620	147: Record<string, number> = { yvtbjkxko: 452, dflpcpdwi: 42, xlezkhqqb: 956, mtcnezsjk: 394	148: Record<string, number> = { nfmcahrgw: 205, mskbtkgmp: 903, wyhstbyom: 487, fuuqpvwcl: 234	149: Record<string, number> = { ywanbizpt: 949, luoyhbjha: 464, hqkwtdomn: 177, yyhmfsrmi: 610	150: Record<string, number> = { aayvjpzwg: 860, drkcdceen: 51, xfghzcebk: 219, unyyasfcw: 247	151: Record<string, number> = { dwnmozwpn: 368, dhkkfkxwf: 89, quoynaprr: 970, otmxiocys: 194	152: Record<string, number> = { qnmvzufkx: 110, jhessxwga: 304, tqkcfywkh: 704, icwngpmig: 244	153: Record<string, number> = { zxijyjbes: 328, mspgzhfty: 230, kpwggynlf: 149, qamkscpmt: 73	154: Record<string, number> = { jokvqsfua: 724, cbpbmsdmo: 680, guwejtick: 657, zythprblt: 80	155: Record<string, number> = { lsfbadflp: 361, cwtbowfzu: 802, uyfkkslge: 804, jatiebiyd: 774
156: Record<string, number> = { bjgtuagxh: 562, krmubwoeh: 282, gbxaahiug: 778, rcroicqbj: 662	157: Record<string, number> = { xxvhljkpl: 976, rylakftgr: 762, wdvuuanmr: 918, qjxodaaxg: 468	158: Record<string, number> = { ihxtxpwdz: 728, wkfpaqwro: 988, ioiucqtyf: 344, grftftvhj: 506	159: Record<string, number> = { bzpvctgrb: 670, oukikxaee: 242, creowubrc: 106, prrcjsrts: 621	160: Record<string, number> = { zmzxmgkrc: 890, ylnxmwnxv: 139, drrwvrrem: 107, msgrltizj: 898	161: Record<string, number> = { vhkgqavdq: 726, oacqwgfkg: 648, iicwgnmzv: 56, rdkyxpzyf: 65	162: Record<string, number> = { dtxdwuhax: 947, snlsleiki: 759, ibyftldvf: 486, fpvpmhzpr: 296	163: Record<string, number> = { fqeuxuqux: 643, pwfpzzzgh: 797, tqypijbbk: 788, rpcetwish: 719	164: Record<string, number> = { ewutdctbl: 880, bixltrlzg: 310, cxilmqeym: 661, fgxhmzdiu: 355	165: Record<string, number> = { xiqawcnmb: 282, satbcmezb: 412, hfgliniqa: 133, htmbgmurp: 449	166: Record<string, number> = { ixnwbffjd: 501, hjohuntbm: 241, zuzqotbmx: 32, dmnvizlmu: 894	167: Record<string, number> = { lyxulgyez: 218, hybdslytg: 182, daqwwvspz: 418, awmavdlkz: 254
168: Record<string, number> = { unjelijni: 912, wcfmvgrlo: 960, xxttxkfpj: 494, ijjbfyusl: 27	169: Record<string, number> = { sjusuugxo: 358, rxxcdqhyb: 717, duklxubjb: 799, famhagskl: 350	170: Record<string, number> = { hazhashzf: 608, dmofowanh: 100, adbjdyjch: 178, bxeynrknk: 870	171: Record<string, number> = { zfxbwmbqs: 939, zkhwbwewr: 312, nwmxvnbfx: 230, ywfhjsien: 960	172: Record<string, number> = { narbenscv: 954, wnwwuitww: 683, relkuzhwo: 874, kygaifvxy: 254	173: Record<string, number> = { bchzevhpb: 902, xulevsqgw: 482, wifndqsyh: 572, gxebbdlcc: 322	174: Record<string, number> = { lluprzvxd: 851, booviehjl: 352, bamjjpsew: 129, xgwvycwcq: 563	175: Record<string, number> = { wgyjjiuve: 240, ddvwgmets: 837, aiurspomx: 414, sxakiiaxs: 708	176: Record<string, number> = { pyozimoso: 833, ecotlnsbr: 539, dqptknxmt: 674, omqvrnjqd: 589	177: Record<string, number> = { wrmondtfm: 978, krpfjnxsz: 980, bpyziisfa: 751, uouxvkrhq: 127	178: Record<string, number> = { oennccbnq: 295, lxnksdtbp: 267, ggyxyifnu: 960, cqdizhmcr: 93	179: Record<string, number> = { gnpvatisj: 387, kvjnmavsf: 661, ryevregqw: 420, tpgtrdywt: 683
180: Record<string, number> = { edmsfoexv: 831, vqyhfoxyg: 92, jmuazfirc: 539, gmdzrskwk: 57	181: Record<string, number> = { rclnhwzlh: 738, kwtqiznni: 311, wistdkzie: 797, uxqydimyk: 222	182: Record<string, number> = { wubchiixj: 510, snoryjvws: 654, fvgquxkqy: 185, zpygpacmc: 767	183: Record<string, number> = { peaugnhxo: 359, vslcnscgf: 482, jljlfniky: 9, tcauiiiit: 359	184: Record<string, number> = { abjtualab: 993, tlixkozqd: 396, nslublrey: 792, mzwljlqxv: 545	185: Record<string, number> = { qausxnqtb: 296, frdksryxh: 635, tdcfnpgbt: 960, fpwdmywha: 681	186: Record<string, number> = { cwhgxngja: 534, cczlwxkzv: 881, lmpmwlgyz: 136, ezhzcxjnt: 448	187: Record<string, number> = { lhtkuohkf: 981, klnyupspd: 106, laausjubi: 115, zskmmvatd: 938	188: Record<string, number> = { bkplhgaxc: 519, xilbvvtqe: 822, kfrcjkbbx: 686, ohrsbwxwk: 402	189: Record<string, number> = { oswuzhcqp: 354, vjdpasrhi: 915, fozwttxhl: 825, jtvwcriwu: 359	190: Record<string, number> = { rxvyziddr: 617, qmbemvpkg: 769, rtafmhjdy: 332, evomxqipt: 589	191: Record<string, number> = { ncijedwdx: 333, gygpyivho: 570, tstmajcdn: 28, dhnwovyya: 609
192: Record<string, number> = { yejiunxdp: 835, mkucastdx: 955, srazbqlaj: 424, mlymbepkc: 348	193: Record<string, number> = { yigeywapl: 290, zoyjrwyfo: 474, ehzetyigv: 956, wzhjezeyw: 519	194: Record<string, number> = { qrlqfxluu: 760, bwoxhrzcl: 906, insvffttu: 106, zqcrowaxu: 42	195: Record<string, number> = { gyfyzsptx: 37, cdnwljgro: 25, qgmpjkdnd: 40, nbywpqnkh: 382	196: Record<string, number> = { cxnlbdqpb: 566, ekhycfzkq: 398, nlezbavar: 816, vcvlvhjuc: 47	197: Record<string, number> = { rsnycmgqd: 222, zglfmsqlo: 677, vsrbaaiwk: 188, omoobwxmc: 706	198: Record<string, number> = { iujxoaxwx: 655, fbrqdgxkt: 620, vbylbafin: 957, orpgkmute: 491	199: Record<string, number> = { zdvmrjhco: 425, nqjggwyrq: 947, geyvszokf: 817, kiikkwvqx: 994	200: Record<string, number> = { hhcxmpndm: 546, tisowdcgx: 477, gjcpnupod: 246, amxbivuax: 303	201: Record<string, number> = { szscviiut: 379, dldutibrf: 983, sdchitrrh: 694, mufjmgacj: 858	202: Record<string, number> = { lncojlhpn: 706, nsdaysnxn: 381, dxvbwyipb: 566, novktxbfz: 795	203: Record<string, number> = { jphzvotbm: 903, ieoyyednm: 185, vnxbkfqzs: 207, mdtzfseuu: 236
204: Record<string, number> = { kctfwqjnx: 23, usxnyhqzs: 762, gvbkpjnqw: 490, mxenojmmf: 990	205: Record<string, number> = { tcxkhsyjo: 636, mzllafepr: 843, cybnohwpw: 856, jljlfemqd: 486	206: Record<string, number> = { ilgapfdtj: 298, vexswmunc: 131, aktswbbje: 287, iuwfihysa: 547	207: Record<string, number> = { ltsiyjkeh: 669, ukajvsukw: 684, axpyjgjwv: 334, oehmbkual: 599	208: Record<string, number> = { gugimjbgv: 598, fcjscvqjq: 275, zhiapjosh: 876, obijcdeha: 325	209: Record<string, number> = { mrqyezvpn: 974, xtqufyvdo: 513, qysirvoqi: 181, sjlhfnocc: 299	210: Record<string, number> = { ugpadmmax: 434, lfpxihlwb: 53, ppjmklvyg: 235, eqvpxdify: 967	211: Record<string, number> = { xkgueyodc: 322, dguygsudc: 805, urtourrxk: 881, hymfnxvxp: 485	212: Record<string, number> = { vayjprbcb: 19, rsjrobedx: 964, niwhshame: 51, enbhhkpro: 987	213: Record<string, number> = { xdkicndgm: 691, muzzxorid: 478, vnopnowmi: 408, uqrjrlfxh: 211	214: Record<string, number> = { cmycupoyh: 451, avggarqer: 433, ytvzqnlxu: 826, jegdcndow: 787	215: Record<string, number> = { zetqskxzb: 557, ymddufsaz: 458, iecqfrzfe: 422, kpymcxizr: 446
216: Record<string, number> = { nobbzkegi: 328, qbadbrkji: 768, kjpkhjyrg: 542, djjcijclf: 960	217: Record<string, number> = { uglumiyov: 4, eigzaoetk: 131, coolczqac: 327, xfndiapgb: 350	218: Record<string, number> = { mqxdmbgdp: 810, ccwddpxsj: 143, idlbskein: 823, dowcwkydj: 329	219: Record<string, number> = { tzayfhlkg: 882, sxjcrupik: 461, yxhxbijcy: 591, pzydollkm: 41	220: Record<string, number> = { yqkarzgct: 335, ggoeuictd: 347, ynejcjolh: 361, ddmkfrojt: 123	221: Record<string, number> = { vregvnnjs: 892, iautmcqns: 38, fotfixwwn: 354, ulflnfvcr: 33	222: Record<string, number> = { smrpradvz: 854, fduyrwyje: 364, wnfhjfupf: 701, ibmtlkyrf: 593	223: Record<string, number> = { dceyexbvo: 962, dqtsmitcx: 265, gyrzupznd: 526, koyycpiyl: 807	224: Record<string, number> = { aqufgqjax: 228, fpfwbucok: 526, bgeabayaw: 428, urgqxetwq: 104	225: Record<string, number> = { cwmcxsxtj: 520, bwqqgaexo: 974, ewigmhhzn: 91, yhlteaxiv: 343	226: Record<string, number> = { dnednocki: 61, bkqavfjmd: 738, knebaumdj: 908, bjwsbtcjf: 252	227: Record<string, number> = { goikfvxiu: 463, luccfypjz: 273, alyvwtmgy: 939, pmstrmybg: 118
228: Record<string, number> = { dtqtrreyk: 188, pymuddtjg: 416, cfcmtmppz: 981, bniqqhdnp: 643	229: Record<string, number> = { dekbhhksv: 156, hppvqocze: 998, tdhbepevi: 538, zjariaejg: 843	230: Record<string, number> = { tqwhckqfz: 816, ysdlrbgfg: 201, mwgnhrfpg: 698, hwhdukyer: 732	231: Record<string, number> = { jdtvaszax: 648, faebfejzt: 414, ltrlictii: 26, ihqjsvvgb: 8	232: Record<string, number> = { vyojnzlic: 228, wzutyegpu: 387, olqljejwh: 895, ugwcvggdn: 834	233: Record<string, number> = { yhabnadjg: 977, swxofonvw: 550, xerzoadyf: 906, drqrczewz: 283	234: Record<string, number> = { effbbygds: 547, tljhjuuuh: 278, ovpxjmywj: 297, eynmgxazv: 958	235: Record<string, number> = { eodvspnlo: 575, qbmoopmit: 295, zgefqqyvo: 395, inhetutms: 66	236: Record<string, number> = { hevyejukl: 202, znbivjkkc: 561, rqezmjzzm: 980, ongjttmwn: 404	237: Record<string, number> = { nhvddkdia: 761, wtmzmhlwe: 607, ceithrkff: 535, mauqqkjqd: 528	238: Record<string, number> = { jxapdvjkq: 523, lpbmrktvg: 755, wzbldhygu: 710, pgpuigytp: 861	239: Record<string, number> = { cplpupgvk: 272, iuxvxcrbr: 182, wvddqegtm: 862, yliavwqje: 447
240: Record<string, number> = { kysfruyic: 347, gqfhsfwjl: 337, kpgkgwffh: 661, wkberphhz: 183	241: Record<string, number> = { lnigwlutk: 732, dtppjypxe: 455, jjnwkyncr: 241, myzlczdqy: 769	242: Record<string, number> = { comicsmhi: 123, yhqxnlwhm: 995, lthdmodwc: 981, urwfhlvzi: 1	243: Record<string, number> = { ayudrpntz: 476, dysorruze: 399, goikgmibf: 862, cawxjjgbu: 594	244: Record<string, number> = { sfrbelrmg: 373, pdlulnjpo: 4, byuwysosc: 678, lfbitjpfg: 27	245: Record<string, number> = { wdtlwknmc: 192, cdgsyokse: 871, xeiiwjqcg: 91, uoangowfc: 968	246: Record<string, number> = { dxsftbfig: 677, gbyqzljqt: 998, scxuyiqxt: 454, krqubilto: 165	247: Record<string, number> = { ajbvwybvc: 482, qouosazic: 233, zpojzjlnv: 52, nrpoqrpgb: 436	248: Record<string, number> = { yclpvikiv: 356, wiggkfxiz: 173, qdpgpmlsf: 822, axnrlitlv: 906	249: Record<string, number> = { lgeatimgi: 783, nfzhxltvv: 322, euwgcknwl: 215, tblohxlbf: 546	250: Record<string, number> = { prjmedvxs: 362, kjorlxspn: 656, cuvumouyg: 669, dtarcbhhg: 649	251: Record<string, number> = { dilmuxuzb: 550, qupibwmbk: 616, heehyavum: 399, nptppcpja: 479
252: Record<string, number> = { ddvxfdcre: 78, hlwklukoq: 902, paklqqlng: 452, lymwfazye: 191	253: Record<string, number> = { gzkxoerjs: 958, lmizeubkr: 110, dpbanfyjd: 419, iwfihfnqn: 186	254: Record<string, number> = { cmdsrwtsa: 824, nzjpapjmg: 990, ilrpycaxp: 790, uuswbauza: 353	255: Record<string, number> = { nqebogiep: 300, bdelqbiom: 282, tezvvylxx: 365, udquibpaj: 429	256: Record<string, number> = { bczhxqgnq: 576, ldobbnios: 877, riwtdiqdp: 808, imjbylxsb: 374	257: Record<string, number> = { qcysqcmnk: 376, vtvwryifc: 853, aydgjjlyk: 415, lanckpvwk: 32	258: Record<string, number> = { mzajymazd: 348, mgsalaxjr: 275, ydjquwbvb: 536, uluwwpmls: 916	259: Record<string, number> = { vbsaazovo: 455, kgefdclsi: 852, kovfvquuq: 546, ymchunjbv: 477	260: Record<string, number> = { cusvhbwai: 153, vvtzeuyij: 435, jdfzqjbbr: 259, lnerzfima: 63	261: Record<string, number> = { wbxwhzaux: 330, htcynzivu: 203, iptvinktg: 220, fhjdqrxdi: 29	262: Record<string, number> = { scatzowbz: 620, kxruwrxpv: 410, daofdgyaz: 195, mwzbrtids: 95	263: Record<string, number> = { ujpeomvtq: 471, qzpclvmzj: 939, krzkypbzc: 926, etfasyqid: 225
264: Record<string, number> = { fmisrswcr: 959, nlpyzjmzt: 375, wfxqodhvz: 264, zmpgtbrzq: 279	265: Record<string, number> = { lmqerxppm: 315, ucbhnenhu: 458, vkjpleeuw: 953, crrrluizd: 302	266: Record<string, number> = { vwxywusjp: 268, vidbsuuqf: 777, ayymxulom: 139, ukdxbbfiv: 76	267: Record<string, number> = { gjqmiwfrb: 883, pljqqdiug: 728, knzhpyzrt: 363, yjrgcqwyd: 112	268: Record<string, number> = { vvzcpygoc: 428, xrewncasr: 497, suwbkexwi: 642, wzydnsciz: 878	269: Record<string, number> = { qhwedecpw: 294, hmkeukyfz: 985, wbkyfacwe: 976, rwrqvmbsd: 92	270: Record<string, number> = { ozhdsvpad: 24, vfizfnxwe: 238, hmumolcyt: 849, bghvpncsf: 863	271: Record<string, number> = { zixpfwwbp: 822, iadgbxemy: 970, mjypnaqyh: 115, dftkhersf: 746	272: Record<string, number> = { upblpqohv: 329, mrtjijjdb: 578, ufahdvimd: 78, cjomdyrnc: 464	273: Record<string, number> = { xfijnxpsw: 576, saiqcptvg: 851, phwrssnyz: 465, xaeonpcep: 345	274: Record<string, number> = { yeezeamkt: 851, bgxmgzuzn: 688, zpbmqpkqe: 939, lybnqdctq: 399	275: Record<string, number> = { ywyfjuyxm: 706, sdgrasbkr: 879, rffzjiuoo: 420, oospeaykm: 501
276: Record<string, number> = { jwgvkthsj: 968, tvutmbzlx: 499, bzinrnuer: 633, zyjnvkarv: 862	277: Record<string, number> = { nyrhggjmc: 798, umxwvvsxn: 853, yukarvfmy: 80, nwjguvicw: 848	278: Record<string, number> = { rbntdbeiv: 135, nlkpvgopf: 223, lumpiuwuu: 394, enztzpzni: 796	279: Record<string, number> = { eikxqvfba: 240, lehrndqis: 385, mutodtstx: 907, fiepptpxt: 1	280: Record<string, number> = { lthijmjwq: 709, uyocwzewa: 693, brywppwgq: 984, cwcjvnike: 602	281: Record<string, number> = { yhlsjuklw: 954, qtmwfedxr: 354, stvkebiyl: 521, vfdletwwe: 182	282: Record<string, number> = { pdoudfpfb: 526, cwazuwanl: 32, joxfvxrdw: 278, ueirjvbmw: 421	283: Record<string, number> = { mbddahtyy: 950, mlzzxktsp: 292, ddmywxdbi: 590, dvrcjvmqy: 891	284: Record<string, number> = { clgmbyujf: 277, tzisoslha: 649, occdjbgcr: 0, iunveoyoy: 807	285: Record<string, number> = { hjlebqtxd: 208, ihxidjrhx: 357, ngutovrmz: 155, fahgsppxg: 449	286: Record<string, number> = { tojywlwic: 550, mgvqpecys: 250, jtfyucczo: 769, iesgfeuht: 930	287: Record<string, number> = { yzmdykkhg: 492, dtwnpzzlm: 254, dvwbfbtdn: 822, frupkdbvm: 120
288: Record<string, number> = { qetiqffzr: 629, pjuzscdug: 920, gcnwekhsv: 237, daogvlktj: 249	289: Record<string, number> = { tqqhoxktd: 773, tyctqttid: 29, lkytricpb: 682, wmrcqyapq: 6	290: Record<string, number> = { pkgwwxzdn: 872, yfxltzjbm: 107, swbabmrgt: 53, amchcwyqy: 170	291: Record<string, number> = { kuutvtlqr: 447, xnwpkotze: 159, wmtrvzeqk: 227, uuqnvqjdg: 840	292: Record<string, number> = { tveggtitc: 940, psajlrdqn: 112, ybjlnaxql: 863, icgxkrhcr: 496	293: Record<string, number> = { mhsihudtt: 244, npbaccxfc: 33, tzlgqwccu: 9, oxfbmhvtd: 846	294: Record<string, number> = { optgtqton: 297, iwogkyjwb: 564, qojseprdy: 134, ddfwfbzkc: 892	295: Record<string, number> = { nqbnuexin: 518, zujvmywdn: 251, bpayywyeb: 880, kycrhoetb: 859	296: Record<string, number> = { jrodzlayg: 365, qigmvgsfa: 80, kslspjwwg: 30, viixxymbi: 519	297: Record<string, number> = { tyenjmukl: 427, wtaztupdt: 590, zqqichayz: 753, gymathzjg: 947	298: Record<string, number> = { psvebbdwo: 871, bfpupdsbx: 440, gfpvqprsm: 34, lvuwvembx: 66	299: Record<string, number> = { xriuvmtce: 994, zfjcxepou: 382, mplygdwke: 114, jkxfxqcbf: 688`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l) => `  const t${a} };
  all.push(t${12 * n});
  const t${b} };
  all.push(t${12 * n + 1});
  const t${c} };
  all.push(t${12 * n + 2});
  const t${d} };
  all.push(t${12 * n + 3});
  const t${e} };
  all.push(t${12 * n + 4});
  const t${f} };
  all.push(t${12 * n + 5});
  const t${g} };
  all.push(t${12 * n + 6});
  const t${h} };
  all.push(t${12 * n + 7});
  const t${i} };
  all.push(t${12 * n + 8});
  const t${j} };
  all.push(t${12 * n + 9});
  const t${k} };
  all.push(t${12 * n + 10});
  const t${l} };
  all.push(t${12 * n + 11});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    "lists-of-constants/tables-small-s4-same.ts": text(
      `// Lists of constants: tables small  same. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { cbivqcgb: 400, gkservsm: 935, qyidntbn: 282, hqpgbpuc: 991	1: Record<string, number> = { cbivqcgb: 556, gkservsm: 300, qyidntbn: 472, hqpgbpuc: 830	2: Record<string, number> = { cbivqcgb: 744, gkservsm: 563, qyidntbn: 279, hqpgbpuc: 229	3: Record<string, number> = { cbivqcgb: 341, gkservsm: 971, qyidntbn: 471, hqpgbpuc: 143	4: Record<string, number> = { cbivqcgb: 612, gkservsm: 618, qyidntbn: 373, hqpgbpuc: 513	5: Record<string, number> = { cbivqcgb: 43, gkservsm: 661, qyidntbn: 890, hqpgbpuc: 754	6: Record<string, number> = { cbivqcgb: 165, gkservsm: 645, qyidntbn: 739, hqpgbpuc: 185	7: Record<string, number> = { cbivqcgb: 368, gkservsm: 717, qyidntbn: 906, hqpgbpuc: 396	8: Record<string, number> = { cbivqcgb: 480, gkservsm: 518, qyidntbn: 438, hqpgbpuc: 523	9: Record<string, number> = { cbivqcgb: 668, gkservsm: 802, qyidntbn: 200, hqpgbpuc: 915	10: Record<string, number> = { cbivqcgb: 355, gkservsm: 493, qyidntbn: 772, hqpgbpuc: 766	11: Record<string, number> = { cbivqcgb: 22, gkservsm: 914, qyidntbn: 926, hqpgbpuc: 146
12: Record<string, number> = { cbivqcgb: 879, gkservsm: 584, qyidntbn: 96, hqpgbpuc: 499	13: Record<string, number> = { cbivqcgb: 369, gkservsm: 0, qyidntbn: 384, hqpgbpuc: 955	14: Record<string, number> = { cbivqcgb: 880, gkservsm: 3, qyidntbn: 948, hqpgbpuc: 181	15: Record<string, number> = { cbivqcgb: 138, gkservsm: 954, qyidntbn: 708, hqpgbpuc: 386	16: Record<string, number> = { cbivqcgb: 882, gkservsm: 531, qyidntbn: 17, hqpgbpuc: 435	17: Record<string, number> = { cbivqcgb: 332, gkservsm: 564, qyidntbn: 585, hqpgbpuc: 537	18: Record<string, number> = { cbivqcgb: 338, gkservsm: 567, qyidntbn: 58, hqpgbpuc: 547	19: Record<string, number> = { cbivqcgb: 400, gkservsm: 92, qyidntbn: 386, hqpgbpuc: 349	20: Record<string, number> = { cbivqcgb: 906, gkservsm: 714, qyidntbn: 670, hqpgbpuc: 266	21: Record<string, number> = { cbivqcgb: 740, gkservsm: 949, qyidntbn: 291, hqpgbpuc: 592	22: Record<string, number> = { cbivqcgb: 99, gkservsm: 534, qyidntbn: 31, hqpgbpuc: 98	23: Record<string, number> = { cbivqcgb: 754, gkservsm: 299, qyidntbn: 388, hqpgbpuc: 841
24: Record<string, number> = { cbivqcgb: 685, gkservsm: 45, qyidntbn: 756, hqpgbpuc: 468	25: Record<string, number> = { cbivqcgb: 631, gkservsm: 14, qyidntbn: 170, hqpgbpuc: 624	26: Record<string, number> = { cbivqcgb: 210, gkservsm: 639, qyidntbn: 122, hqpgbpuc: 583	27: Record<string, number> = { cbivqcgb: 413, gkservsm: 794, qyidntbn: 278, hqpgbpuc: 425	28: Record<string, number> = { cbivqcgb: 668, gkservsm: 784, qyidntbn: 28, hqpgbpuc: 314	29: Record<string, number> = { cbivqcgb: 443, gkservsm: 929, qyidntbn: 147, hqpgbpuc: 712	30: Record<string, number> = { cbivqcgb: 689, gkservsm: 132, qyidntbn: 619, hqpgbpuc: 125	31: Record<string, number> = { cbivqcgb: 482, gkservsm: 270, qyidntbn: 403, hqpgbpuc: 650	32: Record<string, number> = { cbivqcgb: 712, gkservsm: 493, qyidntbn: 793, hqpgbpuc: 659	33: Record<string, number> = { cbivqcgb: 835, gkservsm: 851, qyidntbn: 702, hqpgbpuc: 166	34: Record<string, number> = { cbivqcgb: 686, gkservsm: 208, qyidntbn: 281, hqpgbpuc: 403	35: Record<string, number> = { cbivqcgb: 325, gkservsm: 843, qyidntbn: 252, hqpgbpuc: 937
36: Record<string, number> = { cbivqcgb: 126, gkservsm: 916, qyidntbn: 40, hqpgbpuc: 45	37: Record<string, number> = { cbivqcgb: 868, gkservsm: 31, qyidntbn: 899, hqpgbpuc: 518	38: Record<string, number> = { cbivqcgb: 891, gkservsm: 390, qyidntbn: 955, hqpgbpuc: 159	39: Record<string, number> = { cbivqcgb: 970, gkservsm: 343, qyidntbn: 940, hqpgbpuc: 940	40: Record<string, number> = { cbivqcgb: 564, gkservsm: 842, qyidntbn: 511, hqpgbpuc: 551	41: Record<string, number> = { cbivqcgb: 532, gkservsm: 647, qyidntbn: 822, hqpgbpuc: 746	42: Record<string, number> = { cbivqcgb: 857, gkservsm: 39, qyidntbn: 399, hqpgbpuc: 323	43: Record<string, number> = { cbivqcgb: 733, gkservsm: 748, qyidntbn: 898, hqpgbpuc: 98	44: Record<string, number> = { cbivqcgb: 998, gkservsm: 639, qyidntbn: 968, hqpgbpuc: 178	45: Record<string, number> = { cbivqcgb: 679, gkservsm: 481, qyidntbn: 431, hqpgbpuc: 755	46: Record<string, number> = { cbivqcgb: 424, gkservsm: 444, qyidntbn: 342, hqpgbpuc: 163	47: Record<string, number> = { cbivqcgb: 994, gkservsm: 333, qyidntbn: 381, hqpgbpuc: 199
48: Record<string, number> = { cbivqcgb: 356, gkservsm: 643, qyidntbn: 601, hqpgbpuc: 885	49: Record<string, number> = { cbivqcgb: 389, gkservsm: 484, qyidntbn: 32, hqpgbpuc: 919	50: Record<string, number> = { cbivqcgb: 769, gkservsm: 263, qyidntbn: 609, hqpgbpuc: 955	51: Record<string, number> = { cbivqcgb: 284, gkservsm: 168, qyidntbn: 85, hqpgbpuc: 46	52: Record<string, number> = { cbivqcgb: 477, gkservsm: 33, qyidntbn: 86, hqpgbpuc: 502	53: Record<string, number> = { cbivqcgb: 509, gkservsm: 131, qyidntbn: 619, hqpgbpuc: 839	54: Record<string, number> = { cbivqcgb: 313, gkservsm: 355, qyidntbn: 339, hqpgbpuc: 744	55: Record<string, number> = { cbivqcgb: 27, gkservsm: 936, qyidntbn: 853, hqpgbpuc: 282	56: Record<string, number> = { cbivqcgb: 306, gkservsm: 93, qyidntbn: 714, hqpgbpuc: 197	57: Record<string, number> = { cbivqcgb: 919, gkservsm: 376, qyidntbn: 822, hqpgbpuc: 898	58: Record<string, number> = { cbivqcgb: 153, gkservsm: 520, qyidntbn: 77, hqpgbpuc: 967	59: Record<string, number> = { cbivqcgb: 27, gkservsm: 54, qyidntbn: 603, hqpgbpuc: 262
60: Record<string, number> = { cbivqcgb: 202, gkservsm: 729, qyidntbn: 915, hqpgbpuc: 755	61: Record<string, number> = { cbivqcgb: 316, gkservsm: 859, qyidntbn: 370, hqpgbpuc: 886	62: Record<string, number> = { cbivqcgb: 582, gkservsm: 742, qyidntbn: 361, hqpgbpuc: 566	63: Record<string, number> = { cbivqcgb: 553, gkservsm: 372, qyidntbn: 534, hqpgbpuc: 558	64: Record<string, number> = { cbivqcgb: 562, gkservsm: 613, qyidntbn: 559, hqpgbpuc: 715	65: Record<string, number> = { cbivqcgb: 249, gkservsm: 680, qyidntbn: 274, hqpgbpuc: 597	66: Record<string, number> = { cbivqcgb: 427, gkservsm: 545, qyidntbn: 84, hqpgbpuc: 688	67: Record<string, number> = { cbivqcgb: 640, gkservsm: 494, qyidntbn: 513, hqpgbpuc: 96	68: Record<string, number> = { cbivqcgb: 443, gkservsm: 498, qyidntbn: 520, hqpgbpuc: 57	69: Record<string, number> = { cbivqcgb: 148, gkservsm: 709, qyidntbn: 475, hqpgbpuc: 437	70: Record<string, number> = { cbivqcgb: 35, gkservsm: 816, qyidntbn: 528, hqpgbpuc: 3	71: Record<string, number> = { cbivqcgb: 315, gkservsm: 578, qyidntbn: 640, hqpgbpuc: 951
72: Record<string, number> = { cbivqcgb: 568, gkservsm: 932, qyidntbn: 985, hqpgbpuc: 280	73: Record<string, number> = { cbivqcgb: 864, gkservsm: 452, qyidntbn: 783, hqpgbpuc: 949	74: Record<string, number> = { cbivqcgb: 185, gkservsm: 35, qyidntbn: 47, hqpgbpuc: 266	75: Record<string, number> = { cbivqcgb: 62, gkservsm: 81, qyidntbn: 688, hqpgbpuc: 319	76: Record<string, number> = { cbivqcgb: 515, gkservsm: 362, qyidntbn: 600, hqpgbpuc: 457	77: Record<string, number> = { cbivqcgb: 106, gkservsm: 342, qyidntbn: 873, hqpgbpuc: 77	78: Record<string, number> = { cbivqcgb: 57, gkservsm: 880, qyidntbn: 446, hqpgbpuc: 806	79: Record<string, number> = { cbivqcgb: 348, gkservsm: 634, qyidntbn: 28, hqpgbpuc: 451	80: Record<string, number> = { cbivqcgb: 768, gkservsm: 174, qyidntbn: 108, hqpgbpuc: 656	81: Record<string, number> = { cbivqcgb: 90, gkservsm: 508, qyidntbn: 669, hqpgbpuc: 355	82: Record<string, number> = { cbivqcgb: 350, gkservsm: 231, qyidntbn: 719, hqpgbpuc: 856	83: Record<string, number> = { cbivqcgb: 598, gkservsm: 894, qyidntbn: 641, hqpgbpuc: 633
84: Record<string, number> = { cbivqcgb: 861, gkservsm: 652, qyidntbn: 926, hqpgbpuc: 554	85: Record<string, number> = { cbivqcgb: 472, gkservsm: 212, qyidntbn: 651, hqpgbpuc: 90	86: Record<string, number> = { cbivqcgb: 167, gkservsm: 564, qyidntbn: 681, hqpgbpuc: 923	87: Record<string, number> = { cbivqcgb: 189, gkservsm: 991, qyidntbn: 638, hqpgbpuc: 839	88: Record<string, number> = { cbivqcgb: 999, gkservsm: 201, qyidntbn: 78, hqpgbpuc: 256	89: Record<string, number> = { cbivqcgb: 789, gkservsm: 88, qyidntbn: 849, hqpgbpuc: 741	90: Record<string, number> = { cbivqcgb: 849, gkservsm: 469, qyidntbn: 30, hqpgbpuc: 91	91: Record<string, number> = { cbivqcgb: 362, gkservsm: 875, qyidntbn: 66, hqpgbpuc: 933	92: Record<string, number> = { cbivqcgb: 510, gkservsm: 479, qyidntbn: 155, hqpgbpuc: 73	93: Record<string, number> = { cbivqcgb: 615, gkservsm: 285, qyidntbn: 389, hqpgbpuc: 743	94: Record<string, number> = { cbivqcgb: 145, gkservsm: 923, qyidntbn: 884, hqpgbpuc: 257	95: Record<string, number> = { cbivqcgb: 466, gkservsm: 32, qyidntbn: 626, hqpgbpuc: 691
96: Record<string, number> = { cbivqcgb: 780, gkservsm: 367, qyidntbn: 362, hqpgbpuc: 29	97: Record<string, number> = { cbivqcgb: 431, gkservsm: 38, qyidntbn: 414, hqpgbpuc: 897	98: Record<string, number> = { cbivqcgb: 1, gkservsm: 227, qyidntbn: 972, hqpgbpuc: 287	99: Record<string, number> = { cbivqcgb: 335, gkservsm: 792, qyidntbn: 241, hqpgbpuc: 687	100: Record<string, number> = { cbivqcgb: 484, gkservsm: 762, qyidntbn: 280, hqpgbpuc: 835	101: Record<string, number> = { cbivqcgb: 283, gkservsm: 5, qyidntbn: 55, hqpgbpuc: 353	102: Record<string, number> = { cbivqcgb: 437, gkservsm: 862, qyidntbn: 533, hqpgbpuc: 454	103: Record<string, number> = { cbivqcgb: 339, gkservsm: 411, qyidntbn: 544, hqpgbpuc: 934	104: Record<string, number> = { cbivqcgb: 66, gkservsm: 350, qyidntbn: 371, hqpgbpuc: 134	105: Record<string, number> = { cbivqcgb: 564, gkservsm: 665, qyidntbn: 815, hqpgbpuc: 544	106: Record<string, number> = { cbivqcgb: 919, gkservsm: 921, qyidntbn: 594, hqpgbpuc: 797	107: Record<string, number> = { cbivqcgb: 896, gkservsm: 128, qyidntbn: 714, hqpgbpuc: 69
108: Record<string, number> = { cbivqcgb: 495, gkservsm: 727, qyidntbn: 937, hqpgbpuc: 446	109: Record<string, number> = { cbivqcgb: 266, gkservsm: 306, qyidntbn: 532, hqpgbpuc: 459	110: Record<string, number> = { cbivqcgb: 848, gkservsm: 764, qyidntbn: 235, hqpgbpuc: 956	111: Record<string, number> = { cbivqcgb: 191, gkservsm: 163, qyidntbn: 235, hqpgbpuc: 642	112: Record<string, number> = { cbivqcgb: 695, gkservsm: 166, qyidntbn: 875, hqpgbpuc: 518	113: Record<string, number> = { cbivqcgb: 34, gkservsm: 405, qyidntbn: 13, hqpgbpuc: 52	114: Record<string, number> = { cbivqcgb: 326, gkservsm: 594, qyidntbn: 245, hqpgbpuc: 580	115: Record<string, number> = { cbivqcgb: 570, gkservsm: 644, qyidntbn: 887, hqpgbpuc: 850	116: Record<string, number> = { cbivqcgb: 783, gkservsm: 621, qyidntbn: 899, hqpgbpuc: 49	117: Record<string, number> = { cbivqcgb: 477, gkservsm: 110, qyidntbn: 913, hqpgbpuc: 659	118: Record<string, number> = { cbivqcgb: 102, gkservsm: 610, qyidntbn: 369, hqpgbpuc: 0	119: Record<string, number> = { cbivqcgb: 639, gkservsm: 81, qyidntbn: 164, hqpgbpuc: 809
120: Record<string, number> = { cbivqcgb: 853, gkservsm: 505, qyidntbn: 948, hqpgbpuc: 501	121: Record<string, number> = { cbivqcgb: 334, gkservsm: 735, qyidntbn: 887, hqpgbpuc: 702	122: Record<string, number> = { cbivqcgb: 112, gkservsm: 367, qyidntbn: 559, hqpgbpuc: 206	123: Record<string, number> = { cbivqcgb: 805, gkservsm: 842, qyidntbn: 8, hqpgbpuc: 988	124: Record<string, number> = { cbivqcgb: 685, gkservsm: 214, qyidntbn: 587, hqpgbpuc: 681	125: Record<string, number> = { cbivqcgb: 557, gkservsm: 870, qyidntbn: 596, hqpgbpuc: 18	126: Record<string, number> = { cbivqcgb: 388, gkservsm: 257, qyidntbn: 202, hqpgbpuc: 714	127: Record<string, number> = { cbivqcgb: 871, gkservsm: 468, qyidntbn: 110, hqpgbpuc: 839	128: Record<string, number> = { cbivqcgb: 110, gkservsm: 941, qyidntbn: 32, hqpgbpuc: 694	129: Record<string, number> = { cbivqcgb: 523, gkservsm: 836, qyidntbn: 440, hqpgbpuc: 849	130: Record<string, number> = { cbivqcgb: 640, gkservsm: 726, qyidntbn: 467, hqpgbpuc: 441	131: Record<string, number> = { cbivqcgb: 957, gkservsm: 48, qyidntbn: 416, hqpgbpuc: 405
132: Record<string, number> = { cbivqcgb: 796, gkservsm: 142, qyidntbn: 227, hqpgbpuc: 955	133: Record<string, number> = { cbivqcgb: 899, gkservsm: 813, qyidntbn: 219, hqpgbpuc: 722	134: Record<string, number> = { cbivqcgb: 778, gkservsm: 813, qyidntbn: 990, hqpgbpuc: 885	135: Record<string, number> = { cbivqcgb: 737, gkservsm: 369, qyidntbn: 892, hqpgbpuc: 60	136: Record<string, number> = { cbivqcgb: 520, gkservsm: 73, qyidntbn: 688, hqpgbpuc: 969	137: Record<string, number> = { cbivqcgb: 420, gkservsm: 615, qyidntbn: 618, hqpgbpuc: 410	138: Record<string, number> = { cbivqcgb: 932, gkservsm: 114, qyidntbn: 59, hqpgbpuc: 300	139: Record<string, number> = { cbivqcgb: 602, gkservsm: 709, qyidntbn: 505, hqpgbpuc: 770	140: Record<string, number> = { cbivqcgb: 30, gkservsm: 715, qyidntbn: 759, hqpgbpuc: 408	141: Record<string, number> = { cbivqcgb: 434, gkservsm: 291, qyidntbn: 245, hqpgbpuc: 534	142: Record<string, number> = { cbivqcgb: 810, gkservsm: 438, qyidntbn: 362, hqpgbpuc: 119	143: Record<string, number> = { cbivqcgb: 255, gkservsm: 123, qyidntbn: 191, hqpgbpuc: 48
144: Record<string, number> = { cbivqcgb: 187, gkservsm: 214, qyidntbn: 575, hqpgbpuc: 588	145: Record<string, number> = { cbivqcgb: 684, gkservsm: 18, qyidntbn: 267, hqpgbpuc: 499	146: Record<string, number> = { cbivqcgb: 123, gkservsm: 248, qyidntbn: 11, hqpgbpuc: 588	147: Record<string, number> = { cbivqcgb: 512, gkservsm: 967, qyidntbn: 705, hqpgbpuc: 556	148: Record<string, number> = { cbivqcgb: 407, gkservsm: 6, qyidntbn: 598, hqpgbpuc: 240	149: Record<string, number> = { cbivqcgb: 460, gkservsm: 145, qyidntbn: 451, hqpgbpuc: 583	150: Record<string, number> = { cbivqcgb: 929, gkservsm: 309, qyidntbn: 579, hqpgbpuc: 390	151: Record<string, number> = { cbivqcgb: 440, gkservsm: 403, qyidntbn: 170, hqpgbpuc: 951	152: Record<string, number> = { cbivqcgb: 14, gkservsm: 766, qyidntbn: 637, hqpgbpuc: 339	153: Record<string, number> = { cbivqcgb: 725, gkservsm: 715, qyidntbn: 866, hqpgbpuc: 50	154: Record<string, number> = { cbivqcgb: 44, gkservsm: 540, qyidntbn: 389, hqpgbpuc: 11	155: Record<string, number> = { cbivqcgb: 849, gkservsm: 565, qyidntbn: 548, hqpgbpuc: 478
156: Record<string, number> = { cbivqcgb: 184, gkservsm: 638, qyidntbn: 0, hqpgbpuc: 679	157: Record<string, number> = { cbivqcgb: 572, gkservsm: 952, qyidntbn: 278, hqpgbpuc: 286	158: Record<string, number> = { cbivqcgb: 855, gkservsm: 114, qyidntbn: 366, hqpgbpuc: 893	159: Record<string, number> = { cbivqcgb: 77, gkservsm: 254, qyidntbn: 514, hqpgbpuc: 704	160: Record<string, number> = { cbivqcgb: 946, gkservsm: 841, qyidntbn: 231, hqpgbpuc: 297	161: Record<string, number> = { cbivqcgb: 188, gkservsm: 757, qyidntbn: 169, hqpgbpuc: 326	162: Record<string, number> = { cbivqcgb: 926, gkservsm: 549, qyidntbn: 475, hqpgbpuc: 4	163: Record<string, number> = { cbivqcgb: 711, gkservsm: 889, qyidntbn: 44, hqpgbpuc: 302	164: Record<string, number> = { cbivqcgb: 743, gkservsm: 153, qyidntbn: 375, hqpgbpuc: 72	165: Record<string, number> = { cbivqcgb: 160, gkservsm: 147, qyidntbn: 670, hqpgbpuc: 152	166: Record<string, number> = { cbivqcgb: 376, gkservsm: 565, qyidntbn: 506, hqpgbpuc: 943	167: Record<string, number> = { cbivqcgb: 967, gkservsm: 881, qyidntbn: 110, hqpgbpuc: 532
168: Record<string, number> = { cbivqcgb: 160, gkservsm: 435, qyidntbn: 402, hqpgbpuc: 891	169: Record<string, number> = { cbivqcgb: 662, gkservsm: 816, qyidntbn: 265, hqpgbpuc: 893	170: Record<string, number> = { cbivqcgb: 715, gkservsm: 473, qyidntbn: 360, hqpgbpuc: 806	171: Record<string, number> = { cbivqcgb: 424, gkservsm: 668, qyidntbn: 251, hqpgbpuc: 131	172: Record<string, number> = { cbivqcgb: 624, gkservsm: 71, qyidntbn: 275, hqpgbpuc: 413	173: Record<string, number> = { cbivqcgb: 223, gkservsm: 326, qyidntbn: 290, hqpgbpuc: 109	174: Record<string, number> = { cbivqcgb: 578, gkservsm: 817, qyidntbn: 593, hqpgbpuc: 98	175: Record<string, number> = { cbivqcgb: 76, gkservsm: 455, qyidntbn: 802, hqpgbpuc: 570	176: Record<string, number> = { cbivqcgb: 379, gkservsm: 475, qyidntbn: 328, hqpgbpuc: 147	177: Record<string, number> = { cbivqcgb: 601, gkservsm: 655, qyidntbn: 883, hqpgbpuc: 602	178: Record<string, number> = { cbivqcgb: 190, gkservsm: 662, qyidntbn: 260, hqpgbpuc: 800	179: Record<string, number> = { cbivqcgb: 301, gkservsm: 157, qyidntbn: 679, hqpgbpuc: 222
180: Record<string, number> = { cbivqcgb: 622, gkservsm: 110, qyidntbn: 173, hqpgbpuc: 935	181: Record<string, number> = { cbivqcgb: 515, gkservsm: 260, qyidntbn: 275, hqpgbpuc: 470	182: Record<string, number> = { cbivqcgb: 668, gkservsm: 624, qyidntbn: 418, hqpgbpuc: 824	183: Record<string, number> = { cbivqcgb: 897, gkservsm: 648, qyidntbn: 684, hqpgbpuc: 247	184: Record<string, number> = { cbivqcgb: 508, gkservsm: 384, qyidntbn: 358, hqpgbpuc: 782	185: Record<string, number> = { cbivqcgb: 695, gkservsm: 809, qyidntbn: 720, hqpgbpuc: 904	186: Record<string, number> = { cbivqcgb: 890, gkservsm: 626, qyidntbn: 478, hqpgbpuc: 119	187: Record<string, number> = { cbivqcgb: 325, gkservsm: 227, qyidntbn: 672, hqpgbpuc: 322	188: Record<string, number> = { cbivqcgb: 631, gkservsm: 442, qyidntbn: 92, hqpgbpuc: 232	189: Record<string, number> = { cbivqcgb: 415, gkservsm: 731, qyidntbn: 906, hqpgbpuc: 195	190: Record<string, number> = { cbivqcgb: 555, gkservsm: 749, qyidntbn: 519, hqpgbpuc: 506	191: Record<string, number> = { cbivqcgb: 857, gkservsm: 180, qyidntbn: 932, hqpgbpuc: 788
192: Record<string, number> = { cbivqcgb: 608, gkservsm: 924, qyidntbn: 778, hqpgbpuc: 99	193: Record<string, number> = { cbivqcgb: 549, gkservsm: 996, qyidntbn: 308, hqpgbpuc: 379	194: Record<string, number> = { cbivqcgb: 117, gkservsm: 5, qyidntbn: 572, hqpgbpuc: 693	195: Record<string, number> = { cbivqcgb: 296, gkservsm: 582, qyidntbn: 102, hqpgbpuc: 373	196: Record<string, number> = { cbivqcgb: 312, gkservsm: 238, qyidntbn: 351, hqpgbpuc: 269	197: Record<string, number> = { cbivqcgb: 596, gkservsm: 721, qyidntbn: 385, hqpgbpuc: 231	198: Record<string, number> = { cbivqcgb: 445, gkservsm: 686, qyidntbn: 43, hqpgbpuc: 328	199: Record<string, number> = { cbivqcgb: 673, gkservsm: 205, qyidntbn: 845, hqpgbpuc: 920	200: Record<string, number> = { cbivqcgb: 233, gkservsm: 810, qyidntbn: 680, hqpgbpuc: 476	201: Record<string, number> = { cbivqcgb: 63, gkservsm: 273, qyidntbn: 716, hqpgbpuc: 143	202: Record<string, number> = { cbivqcgb: 176, gkservsm: 128, qyidntbn: 297, hqpgbpuc: 319	203: Record<string, number> = { cbivqcgb: 294, gkservsm: 144, qyidntbn: 558, hqpgbpuc: 448
204: Record<string, number> = { cbivqcgb: 224, gkservsm: 929, qyidntbn: 772, hqpgbpuc: 317	205: Record<string, number> = { cbivqcgb: 573, gkservsm: 188, qyidntbn: 276, hqpgbpuc: 700	206: Record<string, number> = { cbivqcgb: 648, gkservsm: 701, qyidntbn: 87, hqpgbpuc: 98	207: Record<string, number> = { cbivqcgb: 982, gkservsm: 738, qyidntbn: 190, hqpgbpuc: 752	208: Record<string, number> = { cbivqcgb: 321, gkservsm: 763, qyidntbn: 644, hqpgbpuc: 335	209: Record<string, number> = { cbivqcgb: 647, gkservsm: 616, qyidntbn: 584, hqpgbpuc: 255	210: Record<string, number> = { cbivqcgb: 524, gkservsm: 584, qyidntbn: 898, hqpgbpuc: 522	211: Record<string, number> = { cbivqcgb: 531, gkservsm: 520, qyidntbn: 942, hqpgbpuc: 141	212: Record<string, number> = { cbivqcgb: 768, gkservsm: 891, qyidntbn: 572, hqpgbpuc: 473	213: Record<string, number> = { cbivqcgb: 378, gkservsm: 237, qyidntbn: 81, hqpgbpuc: 366	214: Record<string, number> = { cbivqcgb: 455, gkservsm: 442, qyidntbn: 514, hqpgbpuc: 878	215: Record<string, number> = { cbivqcgb: 756, gkservsm: 303, qyidntbn: 543, hqpgbpuc: 483
216: Record<string, number> = { cbivqcgb: 641, gkservsm: 42, qyidntbn: 46, hqpgbpuc: 704	217: Record<string, number> = { cbivqcgb: 866, gkservsm: 265, qyidntbn: 70, hqpgbpuc: 426	218: Record<string, number> = { cbivqcgb: 936, gkservsm: 959, qyidntbn: 918, hqpgbpuc: 995	219: Record<string, number> = { cbivqcgb: 17, gkservsm: 972, qyidntbn: 845, hqpgbpuc: 734	220: Record<string, number> = { cbivqcgb: 507, gkservsm: 496, qyidntbn: 595, hqpgbpuc: 431	221: Record<string, number> = { cbivqcgb: 638, gkservsm: 512, qyidntbn: 692, hqpgbpuc: 270	222: Record<string, number> = { cbivqcgb: 51, gkservsm: 524, qyidntbn: 156, hqpgbpuc: 721	223: Record<string, number> = { cbivqcgb: 568, gkservsm: 828, qyidntbn: 559, hqpgbpuc: 576	224: Record<string, number> = { cbivqcgb: 191, gkservsm: 249, qyidntbn: 418, hqpgbpuc: 284	225: Record<string, number> = { cbivqcgb: 894, gkservsm: 825, qyidntbn: 495, hqpgbpuc: 784	226: Record<string, number> = { cbivqcgb: 448, gkservsm: 647, qyidntbn: 937, hqpgbpuc: 609	227: Record<string, number> = { cbivqcgb: 40, gkservsm: 885, qyidntbn: 755, hqpgbpuc: 664
228: Record<string, number> = { cbivqcgb: 493, gkservsm: 990, qyidntbn: 955, hqpgbpuc: 592	229: Record<string, number> = { cbivqcgb: 736, gkservsm: 486, qyidntbn: 745, hqpgbpuc: 392	230: Record<string, number> = { cbivqcgb: 541, gkservsm: 326, qyidntbn: 744, hqpgbpuc: 148	231: Record<string, number> = { cbivqcgb: 388, gkservsm: 641, qyidntbn: 983, hqpgbpuc: 122	232: Record<string, number> = { cbivqcgb: 124, gkservsm: 479, qyidntbn: 160, hqpgbpuc: 342	233: Record<string, number> = { cbivqcgb: 437, gkservsm: 377, qyidntbn: 93, hqpgbpuc: 149	234: Record<string, number> = { cbivqcgb: 475, gkservsm: 515, qyidntbn: 71, hqpgbpuc: 946	235: Record<string, number> = { cbivqcgb: 969, gkservsm: 75, qyidntbn: 47, hqpgbpuc: 884	236: Record<string, number> = { cbivqcgb: 69, gkservsm: 895, qyidntbn: 997, hqpgbpuc: 995	237: Record<string, number> = { cbivqcgb: 85, gkservsm: 102, qyidntbn: 48, hqpgbpuc: 136	238: Record<string, number> = { cbivqcgb: 220, gkservsm: 509, qyidntbn: 586, hqpgbpuc: 908	239: Record<string, number> = { cbivqcgb: 790, gkservsm: 98, qyidntbn: 2, hqpgbpuc: 404
240: Record<string, number> = { cbivqcgb: 327, gkservsm: 170, qyidntbn: 326, hqpgbpuc: 138	241: Record<string, number> = { cbivqcgb: 567, gkservsm: 901, qyidntbn: 47, hqpgbpuc: 507	242: Record<string, number> = { cbivqcgb: 714, gkservsm: 70, qyidntbn: 314, hqpgbpuc: 46	243: Record<string, number> = { cbivqcgb: 143, gkservsm: 954, qyidntbn: 401, hqpgbpuc: 319	244: Record<string, number> = { cbivqcgb: 928, gkservsm: 362, qyidntbn: 378, hqpgbpuc: 6	245: Record<string, number> = { cbivqcgb: 340, gkservsm: 97, qyidntbn: 889, hqpgbpuc: 687	246: Record<string, number> = { cbivqcgb: 518, gkservsm: 637, qyidntbn: 824, hqpgbpuc: 795	247: Record<string, number> = { cbivqcgb: 829, gkservsm: 663, qyidntbn: 48, hqpgbpuc: 867	248: Record<string, number> = { cbivqcgb: 251, gkservsm: 591, qyidntbn: 632, hqpgbpuc: 899	249: Record<string, number> = { cbivqcgb: 956, gkservsm: 657, qyidntbn: 997, hqpgbpuc: 541	250: Record<string, number> = { cbivqcgb: 686, gkservsm: 861, qyidntbn: 810, hqpgbpuc: 783	251: Record<string, number> = { cbivqcgb: 770, gkservsm: 838, qyidntbn: 666, hqpgbpuc: 279
252: Record<string, number> = { cbivqcgb: 928, gkservsm: 89, qyidntbn: 996, hqpgbpuc: 331	253: Record<string, number> = { cbivqcgb: 725, gkservsm: 847, qyidntbn: 879, hqpgbpuc: 804	254: Record<string, number> = { cbivqcgb: 467, gkservsm: 901, qyidntbn: 291, hqpgbpuc: 506	255: Record<string, number> = { cbivqcgb: 910, gkservsm: 225, qyidntbn: 334, hqpgbpuc: 624	256: Record<string, number> = { cbivqcgb: 764, gkservsm: 213, qyidntbn: 348, hqpgbpuc: 274	257: Record<string, number> = { cbivqcgb: 922, gkservsm: 297, qyidntbn: 502, hqpgbpuc: 240	258: Record<string, number> = { cbivqcgb: 498, gkservsm: 667, qyidntbn: 580, hqpgbpuc: 415	259: Record<string, number> = { cbivqcgb: 949, gkservsm: 774, qyidntbn: 221, hqpgbpuc: 222	260: Record<string, number> = { cbivqcgb: 173, gkservsm: 77, qyidntbn: 413, hqpgbpuc: 409	261: Record<string, number> = { cbivqcgb: 894, gkservsm: 345, qyidntbn: 894, hqpgbpuc: 619	262: Record<string, number> = { cbivqcgb: 190, gkservsm: 503, qyidntbn: 241, hqpgbpuc: 913	263: Record<string, number> = { cbivqcgb: 53, gkservsm: 949, qyidntbn: 718, hqpgbpuc: 408
264: Record<string, number> = { cbivqcgb: 712, gkservsm: 673, qyidntbn: 952, hqpgbpuc: 745	265: Record<string, number> = { cbivqcgb: 758, gkservsm: 352, qyidntbn: 181, hqpgbpuc: 554	266: Record<string, number> = { cbivqcgb: 376, gkservsm: 587, qyidntbn: 675, hqpgbpuc: 646	267: Record<string, number> = { cbivqcgb: 72, gkservsm: 685, qyidntbn: 706, hqpgbpuc: 256	268: Record<string, number> = { cbivqcgb: 82, gkservsm: 746, qyidntbn: 517, hqpgbpuc: 706	269: Record<string, number> = { cbivqcgb: 268, gkservsm: 664, qyidntbn: 167, hqpgbpuc: 454	270: Record<string, number> = { cbivqcgb: 559, gkservsm: 196, qyidntbn: 938, hqpgbpuc: 487	271: Record<string, number> = { cbivqcgb: 592, gkservsm: 342, qyidntbn: 524, hqpgbpuc: 472	272: Record<string, number> = { cbivqcgb: 359, gkservsm: 924, qyidntbn: 478, hqpgbpuc: 232	273: Record<string, number> = { cbivqcgb: 354, gkservsm: 986, qyidntbn: 42, hqpgbpuc: 653	274: Record<string, number> = { cbivqcgb: 859, gkservsm: 878, qyidntbn: 6, hqpgbpuc: 216	275: Record<string, number> = { cbivqcgb: 611, gkservsm: 279, qyidntbn: 363, hqpgbpuc: 934
276: Record<string, number> = { cbivqcgb: 355, gkservsm: 3, qyidntbn: 6, hqpgbpuc: 154	277: Record<string, number> = { cbivqcgb: 464, gkservsm: 649, qyidntbn: 964, hqpgbpuc: 24	278: Record<string, number> = { cbivqcgb: 802, gkservsm: 375, qyidntbn: 460, hqpgbpuc: 711	279: Record<string, number> = { cbivqcgb: 956, gkservsm: 757, qyidntbn: 752, hqpgbpuc: 948	280: Record<string, number> = { cbivqcgb: 227, gkservsm: 151, qyidntbn: 162, hqpgbpuc: 191	281: Record<string, number> = { cbivqcgb: 466, gkservsm: 729, qyidntbn: 344, hqpgbpuc: 685	282: Record<string, number> = { cbivqcgb: 201, gkservsm: 75, qyidntbn: 274, hqpgbpuc: 349	283: Record<string, number> = { cbivqcgb: 594, gkservsm: 181, qyidntbn: 298, hqpgbpuc: 86	284: Record<string, number> = { cbivqcgb: 434, gkservsm: 477, qyidntbn: 333, hqpgbpuc: 312	285: Record<string, number> = { cbivqcgb: 839, gkservsm: 160, qyidntbn: 392, hqpgbpuc: 978	286: Record<string, number> = { cbivqcgb: 810, gkservsm: 181, qyidntbn: 125, hqpgbpuc: 624	287: Record<string, number> = { cbivqcgb: 202, gkservsm: 300, qyidntbn: 752, hqpgbpuc: 152
288: Record<string, number> = { cbivqcgb: 866, gkservsm: 275, qyidntbn: 428, hqpgbpuc: 673	289: Record<string, number> = { cbivqcgb: 513, gkservsm: 705, qyidntbn: 465, hqpgbpuc: 952	290: Record<string, number> = { cbivqcgb: 774, gkservsm: 683, qyidntbn: 942, hqpgbpuc: 684	291: Record<string, number> = { cbivqcgb: 19, gkservsm: 616, qyidntbn: 243, hqpgbpuc: 79	292: Record<string, number> = { cbivqcgb: 644, gkservsm: 881, qyidntbn: 753, hqpgbpuc: 702	293: Record<string, number> = { cbivqcgb: 834, gkservsm: 942, qyidntbn: 966, hqpgbpuc: 672	294: Record<string, number> = { cbivqcgb: 128, gkservsm: 345, qyidntbn: 154, hqpgbpuc: 813	295: Record<string, number> = { cbivqcgb: 814, gkservsm: 864, qyidntbn: 269, hqpgbpuc: 875	296: Record<string, number> = { cbivqcgb: 726, gkservsm: 951, qyidntbn: 281, hqpgbpuc: 982	297: Record<string, number> = { cbivqcgb: 71, gkservsm: 381, qyidntbn: 122, hqpgbpuc: 403	298: Record<string, number> = { cbivqcgb: 936, gkservsm: 105, qyidntbn: 731, hqpgbpuc: 805	299: Record<string, number> = { cbivqcgb: 124, gkservsm: 651, qyidntbn: 968, hqpgbpuc: 507`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l) => `  const t${a} };
  all.push(t${12 * n});
  const t${b} };
  all.push(t${12 * n + 1});
  const t${c} };
  all.push(t${12 * n + 2});
  const t${d} };
  all.push(t${12 * n + 3});
  const t${e} };
  all.push(t${12 * n + 4});
  const t${f} };
  all.push(t${12 * n + 5});
  const t${g} };
  all.push(t${12 * n + 6});
  const t${h} };
  all.push(t${12 * n + 7});
  const t${i} };
  all.push(t${12 * n + 8});
  const t${j} };
  all.push(t${12 * n + 9});
  const t${k} };
  all.push(t${12 * n + 10});
  const t${l} };
  all.push(t${12 * n + 11});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    "lists-of-constants/tables-small-s6-different.ts": text(
      `// Lists of constants: tables small  different. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { qxizmdeos: 214, viogacbot: 416, ckmcopunt: 667, tynrgqlch: 977, tapdhudnv: 552, iogjpqjas: 113	1: Record<string, number> = { wcvbicoqt: 495, aygxbkefy: 495, xvomhhgdg: 2, zoabfgfzd: 69, rjmgdydyt: 748, vpnevxbhq: 77	2: Record<string, number> = { bwobxyztu: 931, pxexppyql: 829, hunyqyewn: 645, llmjeweyo: 84, kzoikqcuk: 593, menlquyso: 286	3: Record<string, number> = { qdqpilduj: 797, xeznquqfe: 792, klykgtsnx: 457, nootrtaoj: 474, gmnsvowcp: 877, kttekylig: 208	4: Record<string, number> = { gjltlvtco: 444, sjokjxqyp: 216, uvykkgtte: 795, ijefuwuzr: 954, ssbpzghsh: 681, ekhmbcgtv: 722	5: Record<string, number> = { btglfdwcm: 898, zfewruzsy: 695, uxlaflvvy: 124, uimqiqpoa: 668, mwjroxejs: 488, qioaiprhi: 462	6: Record<string, number> = { cnhpspkzr: 97, qbfhzkfdd: 914, nhwilnxoc: 167, soxhoqwvp: 753, dscjmxiah: 43, vglqalpic: 375	7: Record<string, number> = { frejelugj: 537, clnvlwgjk: 613, hgwjosvdh: 692, ovwchkkie: 142, demcjbosi: 390, zykavyawo: 802	8: Record<string, number> = { bdfvemnzq: 217, snyjevyuf: 538, pzhlendnj: 170, erywsahqb: 883, hcbydmnsy: 750, xizpwwrcb: 9	9: Record<string, number> = { bcyhplixa: 754, jyzryujhn: 93, tqlgxtxpd: 461, sbjuxcecs: 488, kyquqdycp: 951, biztvcmei: 61
10: Record<string, number> = { lbsbwtohf: 312, znbegqvrt: 567, gmpjcwbox: 363, zqjchqpoy: 850, imonlhtbj: 57, gmavdiezc: 213	11: Record<string, number> = { ekbufarzx: 370, pqpidodom: 155, tgzyejmxp: 360, xagsmfgsw: 238, cbormzewx: 559, jhgtejpgc: 614	12: Record<string, number> = { nrchpxvlx: 457, ljlmllshd: 330, aulwmhsel: 849, cisfwxymc: 252, lpuwbkcvp: 820, loegersxp: 378	13: Record<string, number> = { lkrptfbeo: 243, mrvveaqfp: 707, grjtpvepn: 199, fnqhaiiaz: 150, rkpwgxoqi: 319, irboypllt: 546	14: Record<string, number> = { xhkedgjiz: 804, srzsjgadh: 185, kaglvumis: 586, ngcmqqyaz: 311, ngftkyrpr: 70, puseqrtqd: 366	15: Record<string, number> = { xksdumevo: 254, yhyztqygo: 889, svtqfkjui: 240, mbvcfmbub: 823, vwnzmqduq: 905, cogvphtbj: 612	16: Record<string, number> = { cenwvsutu: 330, gxedkdwfy: 503, ncgghhqej: 907, jercyfbxh: 402, yislgvore: 978, zrmuwxsgs: 847	17: Record<string, number> = { csmjyzvlf: 660, ahjbonkrw: 76, eryvczwpb: 169, hddzulmte: 469, bxyqarkik: 174, ueqpmexto: 328	18: Record<string, number> = { nobsywqix: 891, iamaxlied: 909, vsabllacr: 827, uhzbmmujt: 942, innpxddew: 892, tnobfktfu: 919	19: Record<string, number> = { kpzdaohyv: 523, jyeixmfvb: 345, fhvcolkec: 798, opoeddlgs: 812, bcwijrgkm: 321, cepsscgtx: 9
20: Record<string, number> = { jbvqhauzt: 522, kduurxgbo: 303, hausnapdx: 663, fuojtgkxm: 48, fskkwjmuu: 321, tmohvusqi: 91	21: Record<string, number> = { vobkwqbas: 502, xtrpyaier: 678, iwtypoprm: 331, vbglokjqu: 634, zewwpecci: 255, arsqbjfnz: 149	22: Record<string, number> = { hueezfdgx: 363, fovoucqgr: 157, libcxwiud: 961, auytsawoj: 870, lxypmbyks: 218, kdmfntoxk: 38	23: Record<string, number> = { wqbnqsani: 305, sctidpawx: 763, gymcnimto: 192, vppqocgwq: 115, argtzrusc: 126, gbriqgnuu: 846	24: Record<string, number> = { gkkmivcdw: 125, niutstjzc: 261, gfmhwjyhr: 470, ipoztdsyq: 208, plmanohzj: 612, nrpygwyys: 549	25: Record<string, number> = { mkslyzmjv: 611, oipduwdqk: 458, qoolggyxz: 597, sxbmkotcy: 313, tlxrprpdj: 772, cndxsjuaw: 711	26: Record<string, number> = { lpwxpvgxf: 556, efhzeyixf: 908, mflhniypj: 502, myjqlxpgy: 592, hqabhutrt: 242, dyuauzoff: 139	27: Record<string, number> = { bcsdoasim: 415, rwdplzfri: 388, xhmmjdpud: 946, ejwaqlrkd: 892, vxeaghdeg: 962, klyftbpeu: 984	28: Record<string, number> = { owvcehvuj: 153, vubrtlxxl: 226, cmvuvxjng: 451, fstypkopb: 735, snqndixwl: 43, mmnkzxfxa: 94	29: Record<string, number> = { odugbqkay: 562, gvgbdfcrw: 260, ehdrnicga: 694, rojqsamls: 126, jjzfmjwwj: 802, cloqsyjhw: 720
30: Record<string, number> = { qwrrpuelw: 897, lgtsgqfco: 490, kjtgdaaek: 555, bmjmwqdks: 997, iirasurlc: 720, pyvhkhqfd: 10	31: Record<string, number> = { arjhhgrgf: 815, fbkepmfnz: 672, kenxpfywh: 284, mmyjqlcrg: 14, gakexnlud: 355, zkmnhwpql: 648	32: Record<string, number> = { hmfryuwky: 275, bwqrbnhwy: 337, fzeazdznn: 836, blimlwvte: 138, ogruyfzdk: 165, pigrjpzqy: 965	33: Record<string, number> = { vugpxjkky: 95, scfmtppwa: 130, htcmvzcgq: 40, ajbgmnwbd: 844, nckioglee: 587, afpyeatzg: 812	34: Record<string, number> = { oqamlxkkl: 620, waptywspw: 543, tlvibtwon: 622, ospmplite: 423, oucjupjpf: 742, actxaesht: 701	35: Record<string, number> = { eeczawbsm: 156, alzkgaqop: 175, dqjiwepwz: 643, phopsomag: 597, wpqeufjqz: 778, gmhfminsd: 714	36: Record<string, number> = { jwgobsunz: 465, nmpbwhbqy: 486, ohvpegdrg: 257, hdhluofyc: 162, pxlkunwvs: 364, knwxrjuou: 215	37: Record<string, number> = { tafykmcnm: 194, xqwunhsoz: 815, lambdyrzz: 294, hazqskdiz: 946, aqkiayuvk: 880, bsbbgzfot: 574	38: Record<string, number> = { ohfybmedi: 233, ytaelbacs: 350, iduiflnkk: 212, mloccagag: 527, pyhxxyxrd: 346, ljtorzdvs: 667	39: Record<string, number> = { mjxnbikzt: 929, nucyihhnk: 327, mofjabzqg: 150, rjrlarvag: 390, xjeulhphc: 166, vdcogfobr: 651
40: Record<string, number> = { jbeidsytp: 741, ugkdnplla: 834, spxppjdpp: 982, eozwfuaxt: 119, makmgjjmf: 52, jbykzjobe: 21	41: Record<string, number> = { sqbsxibjq: 458, tsajolxyu: 991, fjuqbuoyb: 457, xysoidjpj: 954, brdxefmwh: 311, nabpmwqiz: 205	42: Record<string, number> = { loltugcis: 997, trjkvafor: 311, fcydntxva: 33, swlnwirxg: 305, vaslnjkyq: 223, cojaitnmy: 545	43: Record<string, number> = { nyioykmoi: 513, orzzuafqu: 534, vzwyrshcm: 694, nwziaojnw: 120, dfrljwlyx: 371, cewcngglr: 632	44: Record<string, number> = { lxsikzffa: 462, xuxsyympb: 283, kedxdibud: 586, pjnbeophq: 914, hwehuijnl: 684, gjijcwnms: 358	45: Record<string, number> = { pcewqetna: 451, caghrtfvo: 173, hziomdvhv: 755, iupjheklf: 51, mysrixrgl: 973, ipsjavklx: 678	46: Record<string, number> = { xbukfuzao: 385, uksshrlvx: 769, zztejffqi: 992, yaghpzsuf: 824, nmfeblovy: 729, jmftgtxfv: 270	47: Record<string, number> = { zgrgskpij: 493, exxdtpvps: 629, zxqrcybay: 927, dekznlnxw: 889, ukitzboxl: 335, vssxqqppy: 960	48: Record<string, number> = { ooiapmkja: 157, wodfmfrrz: 180, hcykmevpq: 93, qtrklcrnq: 107, cbsrwohkc: 798, ifoitgetw: 468	49: Record<string, number> = { megoxshmj: 559, ncjmjslup: 333, mdhjhktvr: 259, vezlejvyk: 208, ooqnhcvqk: 542, mgzpjvqbu: 228
50: Record<string, number> = { brranqzjr: 437, fwqgxuqwg: 688, jkndamlhk: 737, xulzwbjke: 763, qrcdpvjaf: 631, dyrzgmlfl: 176	51: Record<string, number> = { tpteuujpb: 857, hwynhtouq: 399, xsampbxma: 844, svqutpraw: 659, pjgyyvcmd: 395, vpmfcsmwo: 716	52: Record<string, number> = { tjhpahwex: 397, xndvyozpl: 505, ptkdqcvye: 715, aavjrzmzg: 872, ekjfzrelq: 675, vbohycbfs: 679	53: Record<string, number> = { ewrqadddq: 493, znptfwccf: 49, niczwbnbt: 369, vnzsgagbm: 394, twehcqdpd: 673, bmleppzwo: 138	54: Record<string, number> = { xwmxwutss: 72, senjebbcs: 385, pznitwzul: 20, styentjrf: 209, pyaktqzsz: 248, kgwjbvpuk: 138	55: Record<string, number> = { ouepfztxu: 102, xmanxqicl: 833, loqaagayi: 300, humdkfbbj: 810, prqzfmlzf: 180, gadvhltya: 375	56: Record<string, number> = { whnaakves: 340, zpgosoasu: 525, bqbhieikn: 695, ntmknnwax: 760, cdjzbpysk: 367, lhixscixi: 250	57: Record<string, number> = { vpwafqjoi: 893, cllejbbsr: 529, afcjbadcm: 73, vsgnwlrlm: 546, kvbzypyey: 864, bnufavgub: 441	58: Record<string, number> = { wdjzqddld: 617, tcdajdwxu: 466, ubjcidbzs: 25, ispgtjfxu: 437, wirrsjasb: 437, gqicnfefo: 12	59: Record<string, number> = { yorfutxks: 110, zbuvlksyq: 641, xhqdguuxi: 517, gzbbzlyjw: 753, ecpkvyfgm: 312, opzlfrufr: 318
60: Record<string, number> = { anoerbwbo: 452, umkxamzrg: 791, idhlluthh: 967, kybvttqlq: 223, guyfivgzg: 206, snkszqxks: 875	61: Record<string, number> = { hceownefs: 137, qjjamlphr: 597, kgoegmkgu: 393, uqysphmuu: 890, fznzfuhfv: 511, fxvsyvqid: 775	62: Record<string, number> = { jcrksrvwc: 283, okwjhwwvd: 258, cfgeyjujc: 292, hrcaqthoe: 296, paxicuufy: 8, nvhhbcdxb: 548	63: Record<string, number> = { ppfdsmvvt: 716, agqwkmfky: 639, emndcrvms: 605, iuhfjqztc: 342, wcaazleqq: 531, eplaopaca: 834	64: Record<string, number> = { kqiqtzhgt: 582, hcglmrgcp: 984, okjvvjdtv: 312, oukmokuam: 627, hhyytsvya: 604, biwmxkxjd: 2	65: Record<string, number> = { xhipccqaf: 137, fzvhlmtqi: 124, urxrnnyen: 210, suxwlajgl: 125, nyvdojokr: 203, ofkldgove: 508	66: Record<string, number> = { whintubkf: 937, fhmcmutym: 12, gmhhojxha: 72, elvqgdhts: 15, lmxxypumo: 59, yhetfzpur: 586	67: Record<string, number> = { qgmzjkmle: 586, vyigtxxrn: 11, mtbhdioby: 101, xqvuavfkc: 667, qnakvfguu: 79, pwdatvful: 579	68: Record<string, number> = { eitvxakwt: 905, xruxxglav: 595, oajmmhvpy: 139, rkcaoncmj: 846, fqtuxtyvs: 543, qhmxqdpyc: 154	69: Record<string, number> = { ofvfhnohc: 243, medtfzpzh: 616, iorqimhtj: 783, bbqngwrwv: 888, dodeyzfga: 791, fktezmvwf: 911
70: Record<string, number> = { egohxhccb: 940, smaruruyf: 978, smbmwpycu: 82, ptjdxjjbm: 29, tzlzvluye: 416, yzvadyeck: 455	71: Record<string, number> = { utlrymnsj: 705, xjlflvhty: 641, netbkjlcm: 246, hpyvodrkv: 957, jzmztxtqu: 240, ytuqurmes: 21	72: Record<string, number> = { ptwlnuxjg: 799, zijuplnfn: 217, kkuyzfjoy: 310, uqobsnkyn: 464, ihqthfnlp: 260, rgqsqfdfo: 229	73: Record<string, number> = { ynkpejwnw: 385, gnuunbncr: 580, rzybnmvaa: 963, cagcmipzy: 28, kvbwzbqnl: 123, eabcixiub: 335	74: Record<string, number> = { wzvmsgimb: 334, qjdgbgfmo: 775, cpajkqhvs: 288, yrcojfmyp: 366, lvyynfzgw: 730, hckuqwewi: 750	75: Record<string, number> = { frqxbvgic: 778, znmitsrdx: 592, fmvqrnhfp: 158, opzvlkhzz: 882, gnqoyvhgs: 810, attmfvgzf: 869	76: Record<string, number> = { gnoitigfr: 278, ybkuykppe: 622, kuedkizmq: 562, xkmrhkgzt: 809, jnhhsypyp: 896, uzmqopmde: 887	77: Record<string, number> = { egnwoaczd: 128, iimxyftlj: 937, afsrdzqyu: 904, uglbdbkkf: 812, kmclpgtew: 455, lhsuyblsz: 500	78: Record<string, number> = { skvrndecx: 757, bnueevfgk: 289, gweqrrcux: 369, jiucfmvhd: 757, ctlxnniab: 358, heizhbcaq: 148	79: Record<string, number> = { zmbukwmzr: 335, wmguyiflf: 403, ajeqrmxgj: 257, gxfuwjhpv: 349, ukwogjvvv: 43, hfmvnrmaq: 645
80: Record<string, number> = { gizpbnkcb: 582, rfbxjpyqt: 263, fvliliblr: 110, ozpbnqhtk: 338, zcfxxlmfa: 417, rgoysyjei: 652	81: Record<string, number> = { jnfdhoblv: 535, klsuvkbfp: 396, yiofwhiws: 743, jzcmncjqr: 543, khjwireyj: 351, rbzvbelwr: 499	82: Record<string, number> = { czvnsvgev: 830, yvcrbufcz: 738, csmswrhda: 848, djoubtcls: 818, vymiuzrmk: 514, nfehrhoch: 628	83: Record<string, number> = { ruodvxhyv: 297, ieqygexgo: 113, swwnxnpwo: 286, pxczolroh: 455, ovbtstnni: 915, njkvtugke: 55	84: Record<string, number> = { cvgavejbs: 410, xrkcnyahw: 222, ataampups: 55, jkmhyykve: 601, onpiqgulw: 747, fqlvmyjit: 623	85: Record<string, number> = { gqggrmfoh: 671, wbqlovxce: 69, khywsrbyg: 545, uwrsdvfub: 934, xvhirhnul: 90, jwtbevlki: 529	86: Record<string, number> = { gqomkhast: 805, odvadsmet: 127, ntrjgnmsf: 208, mljxnfdrx: 688, dckxcawvi: 423, vkmgnkuxn: 635	87: Record<string, number> = { yxozyfmdk: 884, oimqinano: 991, brswturnq: 378, mozdwwlqk: 453, xtmzlgdwf: 326, nxioqbdpd: 682	88: Record<string, number> = { oyzsbfyrs: 334, iojasydof: 874, hlaocssvq: 489, cmnqtppms: 324, totcusfyw: 130, jovdfidcd: 645	89: Record<string, number> = { kjlmjvwrq: 476, brvzybmzz: 91, zedoyzcew: 688, erfdkarna: 705, mmgoxwofg: 213, ualwywjys: 657
90: Record<string, number> = { sjsitvgvh: 748, odlymtsts: 722, tmafufmzr: 693, bqxyzeirg: 168, mtjzczqbv: 99, igpqzbtzu: 480	91: Record<string, number> = { vepskxlee: 917, jedczrkxo: 262, rdfeacbhw: 448, lwpyrxuag: 130, pzjewahuv: 919, cwczpbfss: 208	92: Record<string, number> = { vinjuezdn: 137, hehtexokb: 549, zoahnlvxi: 507, qqykiozmk: 926, epakelkca: 78, mmxmgluhb: 910	93: Record<string, number> = { zjvmqbqup: 599, xcuccvqhe: 109, qayfbgpwd: 73, aeimvghxb: 917, gmfpmorix: 730, emjnubgjs: 449	94: Record<string, number> = { ulnyitxfy: 4, hilngjkaf: 178, svrktgnzx: 297, qaeshwfwl: 752, kcaavbhuu: 205, bsdxgkoal: 821	95: Record<string, number> = { scbconvor: 491, eigtezark: 94, pjysnegpj: 172, mnbfmumxt: 531, qfaytppty: 214, skznsydpz: 111	96: Record<string, number> = { iifppgorv: 347, zknomkztx: 105, luypgvwuv: 51, qysrallhe: 435, ocwswmhyh: 875, mbsmyjwbs: 169	97: Record<string, number> = { ithazdkcd: 675, gejyrzdrw: 497, lcuaviicr: 538, fxqgyvpvn: 906, xwamigxqx: 409, azhtibcvt: 920	98: Record<string, number> = { jlopoodqz: 662, haoajzjhk: 871, kdbaqnvvl: 248, hbwmyjhlq: 910, vafpwztgn: 526, ipfzgxnhx: 493	99: Record<string, number> = { httsvzrdu: 177, jlxxdwwqx: 12, tvqtytlhz: 912, mmkuyyhex: 267, kavazscnn: 381, cfnomcuur: 297
100: Record<string, number> = { roogxtonl: 708, gydfidheu: 715, uftbyrkur: 346, depbiatta: 915, uhkrmxtje: 203, mweqisqby: 889	101: Record<string, number> = { kmvkkkeyu: 286, jduxwowjf: 986, flvtstohi: 574, kyzeyehjt: 644, ddrjligxw: 858, afruggvzf: 251	102: Record<string, number> = { myndcswhp: 236, jmuctiegn: 834, iaalybiyt: 301, rdkciumdc: 348, dmlxddgqv: 2, qbfxwsmui: 152	103: Record<string, number> = { rjhkxpbik: 777, gmgneuacc: 211, xhxybnwii: 290, jresreulu: 204, ljjdetlni: 314, bsidenxdl: 845	104: Record<string, number> = { sfontkjvq: 932, hixsxdqoq: 971, rvnvsdbve: 648, uvobrpkjk: 802, aqnyxuluc: 599, tkqvppzdj: 911	105: Record<string, number> = { vameiezjh: 677, akuosvfrg: 616, hcdxbvsmj: 439, howoxjddj: 125, wjggozghg: 772, ueoqnfxkd: 263	106: Record<string, number> = { nxpydxqnc: 40, hlucjssvb: 610, btimpjlut: 170, myxeisvfp: 345, mhhmteejz: 343, npboxpuej: 420	107: Record<string, number> = { qoogrkbuh: 350, xkxtoylin: 104, ijzvfsgup: 84, almbijafq: 928, kajpqbjjb: 785, jwvffkfxa: 419	108: Record<string, number> = { fafxjjlxw: 434, mmnopoosl: 501, mubblpgig: 766, oeqqauncb: 479, vuzugcffr: 672, xfclfjxwz: 239	109: Record<string, number> = { wdfjoxdfp: 464, mwxgxdeyn: 164, sjzjyodvp: 444, irkskxkyo: 418, wptlulmfm: 659, vwsnvpixv: 135
110: Record<string, number> = { rklmqxtvp: 183, vdimtdtod: 939, aysfccith: 136, ozeiduuty: 208, ruluuphup: 775, yqsclauvo: 73	111: Record<string, number> = { yksqiusxn: 869, wjjnuhdmg: 602, dsytctxlk: 396, uzvowcqyo: 359, shwsrmblg: 387, alorvxjbi: 29	112: Record<string, number> = { avgwssmku: 922, nyroqsfde: 91, ngalikixu: 649, irydtervc: 463, rztiakgxo: 338, xkuxvdzrt: 642	113: Record<string, number> = { rwnqffyle: 935, cxitnftcy: 330, pxfetzgns: 854, tzhuiuckn: 246, outtlylxi: 54, gnzlfuuik: 443	114: Record<string, number> = { uupblfghx: 77, yvediyaav: 223, alxtqfrzd: 16, fodykpddt: 887, guxjnpiiz: 686, anmqcsgrp: 187	115: Record<string, number> = { dsalgfmzk: 334, bqygmgrih: 804, murtyehkr: 468, zdwfxtfcn: 118, mlhlostnn: 304, ajelwfjpa: 255	116: Record<string, number> = { nfojnrihx: 978, hlieeznqf: 784, ogyycebbq: 286, bbcmndzob: 109, imbcbeedw: 507, tgicyjyxa: 491	117: Record<string, number> = { wthwnfwyg: 487, gkrocnbyi: 494, dyyzoimmj: 695, tnaizkgpx: 586, qmhalopwe: 377, mxxrzwvdv: 736	118: Record<string, number> = { ldebccnyg: 180, aniozseli: 352, pxxwykorj: 221, zlmrhqptb: 828, aihpfqcps: 554, gvctqkpcp: 29	119: Record<string, number> = { wqcljbuou: 787, ojkdpafla: 855, pgepibvcf: 9, pazcxtgxc: 675, ywntaatqc: 956, ocszjmovz: 634
120: Record<string, number> = { wfzlpzgus: 472, ivhhyidhc: 311, iceiawege: 832, kcsvhfule: 499, chtfopjvb: 813, bmbwuqtsb: 837	121: Record<string, number> = { flbqkbgqv: 226, mevianuyp: 215, ziwixysof: 255, pcwtwuukz: 439, jraqjxugj: 749, zxevngugq: 281	122: Record<string, number> = { ebrvwproi: 940, xckapugwb: 412, oxxcqyjac: 494, rhpgzsebe: 259, umfvhryko: 42, kbfjxhnib: 100	123: Record<string, number> = { zxkdbzbgg: 966, iwezhqrft: 340, rydyldhkw: 674, krvputcdb: 563, ynfcdsxae: 388, jhzydnzig: 350	124: Record<string, number> = { qrcoujxll: 800, gkucqokpk: 288, dsiqylthl: 229, hbqidknjp: 117, zpulfvtwl: 330, fbxvrgwlo: 963	125: Record<string, number> = { kzecbwdjj: 779, sneqygksc: 390, dfbegenub: 209, sxyxugmcn: 110, ombhtdpxy: 791, oypwzcbss: 203	126: Record<string, number> = { ucfqthwus: 205, zztfqdsqs: 100, otioiaxlf: 844, gtacdjfca: 932, urxapkarr: 95, lhaqxcwvu: 182	127: Record<string, number> = { jemzlwzoq: 111, okdwzxtvy: 400, azvqzrixx: 654, pojdicxlj: 196, uyvriqmnt: 360, dhestexjb: 923	128: Record<string, number> = { emhlqxyok: 364, wasgqempx: 672, dmuyynzww: 620, casludhtk: 547, jozhyevjo: 855, nfiuvmfbs: 185	129: Record<string, number> = { rvfkvefvh: 37, szmnatbnr: 541, yoshjmbiq: 594, qwxfzmtlq: 110, fawgoeprw: 235, fhxjkylhq: 917
130: Record<string, number> = { pqlxkzxuv: 301, vlmbiifcx: 929, applftevl: 615, gtylxuvkr: 868, zbkmtuokn: 825, xfpoidaio: 26	131: Record<string, number> = { ulkbadazk: 564, adiftqjwi: 690, chcgdzwca: 901, lwaoqlxus: 227, titmdlmau: 369, ddydaglqi: 624	132: Record<string, number> = { hgvbgucgy: 414, nijxsmcxh: 760, qiqgyjgrs: 104, mbmsvtfyg: 939, oxynqbiem: 481, wqfmhiagm: 705	133: Record<string, number> = { fudlurmaz: 109, ezfyxwaku: 400, hxqjntdlp: 386, sazdvfeay: 853, cpzggkgkr: 647, wqqwnrrmh: 746	134: Record<string, number> = { hulbldvhl: 905, yldvkarvt: 374, kbqtdccce: 705, udmgtjfep: 253, mtfflyphp: 689, itbvnkafg: 326	135: Record<string, number> = { ktforemvh: 247, dbboonjup: 14, leamuwfgm: 525, ykslzcgyy: 407, xqsplrvsq: 7, zjvfbzvri: 310	136: Record<string, number> = { ljomuvxzv: 817, ihjqnfdvy: 859, vhcotttwk: 840, ewjhgtlfh: 78, sbhvhjifp: 793, looiohnie: 221	137: Record<string, number> = { qtjzmvqiy: 742, nahrrvjch: 60, qtuxdmjtr: 333, vwbfsbqgl: 523, pepipretz: 714, opoetyrnz: 40	138: Record<string, number> = { jexjiiekt: 305, jzsbwdonj: 511, tywzfzmqx: 10, ugkuqbefs: 895, btcsweqoj: 829, rwqgbjbtu: 374	139: Record<string, number> = { kjjmgxdph: 358, ditooqjar: 652, rtxewfuut: 776, yrqcodygb: 789, asseoblpj: 627, dkgztkvyp: 32
140: Record<string, number> = { tmvzfhxka: 207, yjqrmkrrh: 844, qivwugrda: 208, pajdagnfp: 130, ctcobmekp: 55, smevqbkhe: 897	141: Record<string, number> = { bmljuyyaf: 456, ewamorcyy: 90, divlauyyn: 286, ysisizysy: 825, ovyliiatb: 632, auavafpsi: 484	142: Record<string, number> = { nzmmpzzfw: 703, flkvhinjm: 668, pdizktppz: 414, zakrvkevf: 593, wmkposymm: 184, lkgiyqxcg: 721	143: Record<string, number> = { hzgddngfy: 460, kqcsrrpoo: 559, xoogczrgg: 113, hhkqjigne: 808, gcnpzlaqs: 219, rxuclrbad: 983	144: Record<string, number> = { lpueigzbi: 831, rhyddhqhg: 960, uhitndosk: 505, tkvehdkko: 729, jbdyuejnc: 590, kfpcjqbiq: 775	145: Record<string, number> = { aywdokevm: 474, samytbehu: 835, vmfefborv: 659, hgrshfmnw: 965, ncigabdqb: 947, ktnkpxpvg: 902	146: Record<string, number> = { gvenhwdiv: 36, ksinrsjgc: 571, oqetwjink: 671, fretuxxxe: 195, kwvaeyfvt: 947, freyiexmc: 991	147: Record<string, number> = { efmdppjmd: 153, vvbxzhveq: 917, vodkzxwgr: 591, hwmlljagl: 659, lwtmskxdm: 758, whxnkhlue: 936	148: Record<string, number> = { szcvttqoi: 867, bavffggnx: 870, xzppynnzb: 354, lkjxwrcpb: 566, vmupphxnl: 212, onzleynxl: 818	149: Record<string, number> = { yjrqkzsiw: 482, gvalfvhwf: 685, ttdbcwlvy: 59, mxqtxlrot: 98, uuwrohhdr: 200, fmspsoats: 101
150: Record<string, number> = { syspbnoro: 725, brhjzinyw: 646, cfbiarqss: 405, kgfnesfbc: 708, caxfucryw: 195, pfiwzdank: 238	151: Record<string, number> = { yrsgihkis: 572, dqkzcnulu: 858, queekytft: 531, yhahecfaa: 534, dfvolxagn: 377, ddfwhwwza: 577	152: Record<string, number> = { ymetqokry: 346, kynfhwokg: 648, ersgqbedc: 261, fgwmefdka: 106, hlwqfstpf: 589, ccorxsyls: 811	153: Record<string, number> = { auowewgex: 938, fdcfbqwul: 449, qwpcjfjiu: 814, zlnkwpmlh: 68, ecvjgqqsu: 20, patnlhulk: 991	154: Record<string, number> = { yzzeczqky: 528, jwdwddsob: 356, izxsaabwv: 764, obayjpsov: 67, fgxuooudu: 803, rmzwagjes: 222	155: Record<string, number> = { bseppilsk: 189, tzpueazlo: 432, rorltgfjt: 445, ifzcnafum: 370, zqpdaogkt: 259, udsjihypc: 999	156: Record<string, number> = { wzyizvcpn: 815, dmgebdhbi: 144, jnhiczzrd: 34, gnabacqji: 835, fouhmttoe: 930, mptdrmglc: 307	157: Record<string, number> = { xlpnlelal: 316, cksbrihvf: 431, elcjsvslp: 299, cyujzwfeq: 189, tpuyfhqjl: 543, hsaxvwfri: 784	158: Record<string, number> = { xwplqbwoh: 583, ecyewqfuo: 664, bgptyoduu: 510, ggupujndp: 602, cabudriat: 609, vosdbqsdo: 158	159: Record<string, number> = { uatnwgjrs: 668, zgflerdml: 748, kzzwuunsk: 904, dvovpnszf: 699, utvwbbmqw: 950, ghkalxbqp: 871
160: Record<string, number> = { ukvxvdgja: 559, cccnjuwij: 670, umotfgazd: 114, guplybysf: 657, enhvuedin: 285, ioafgiece: 537	161: Record<string, number> = { cibiocubt: 965, vbdlfljpa: 408, lzmsvtazd: 303, soqvwpszq: 743, ukjvteyip: 449, irxostidx: 842	162: Record<string, number> = { hdtgiiqmg: 923, jqbvuoomc: 266, jsaxuvmiy: 684, kdimzwrem: 649, pxyrkuaxq: 267, xakzbmlfe: 769	163: Record<string, number> = { uouxlnnqp: 856, mpyrsilyo: 689, ivgbqwfki: 274, oizfmrktv: 773, baevkrusc: 823, fcszneflr: 335	164: Record<string, number> = { bdqljrbtv: 834, kzgtrfzvq: 50, vzowghbhk: 239, oulkropwo: 138, juklvojzv: 158, xxbilxkrf: 383	165: Record<string, number> = { woaxcvfkh: 118, okhhyeesk: 598, tcktisfcj: 855, lbvefdvqe: 135, ismfdokjl: 573, jdihyduaq: 318	166: Record<string, number> = { csksaiuwx: 701, rpapighne: 951, vxytlyzfv: 53, cwzahfaog: 576, znvzqpavr: 876, hxjblcqgt: 315	167: Record<string, number> = { rlmuntrzc: 38, lqbxvqyad: 778, pxqkvcxzl: 607, wgjkjsflc: 387, ftbnebtxr: 298, nszevuccp: 617	168: Record<string, number> = { bpbgmgwew: 984, azmndshmi: 245, meamxcoyx: 514, dwtpeatfw: 434, qznvordbe: 408, nchdxaqae: 8	169: Record<string, number> = { mggqmwgzg: 22, vwukwrcow: 25, eihzfeehy: 382, mfajpklae: 965, byrohlajt: 125, eumevuupp: 591
170: Record<string, number> = { oeeyyfpdq: 697, txgcvmxjd: 590, vnyovyzus: 736, rtshxucbx: 648, bhacohoxj: 158, krspxnzto: 142	171: Record<string, number> = { vwfgihaxk: 148, hzzrsftfu: 96, htmhaxzyq: 854, yhcleiafm: 623, tikbvupfm: 565, unufbeuem: 465	172: Record<string, number> = { jnzwkcefl: 388, xhebekacw: 172, jwmkplemu: 215, tcocbvisx: 719, mlxbdjjky: 640, gxiaeujyu: 20	173: Record<string, number> = { ibjvspeoq: 793, uzzagdfta: 76, ldfgzmoyn: 968, uewngknzo: 422, ulrsrivpz: 801, wslxepmvv: 773	174: Record<string, number> = { xcnefcmje: 379, ypzxskjwz: 68, bjgjchbey: 634, hfmuwzetx: 970, rcytizihr: 165, ftwomnuyz: 132	175: Record<string, number> = { eacnmqpti: 272, cznpuxwza: 826, ybnmqmcvv: 961, gpawmfipm: 104, kqedszpxo: 492, sdvozyepl: 814	176: Record<string, number> = { ubgkzyoau: 154, ibbtwemjy: 417, jdrhzvzkg: 700, tqnsmvuvu: 975, nyzbkzrzx: 638, hyhcictot: 387	177: Record<string, number> = { luppvzsew: 995, xnpcmbsrx: 319, lgefwdrkh: 654, vubkrevif: 365, lqnpwlueo: 701, vshzgevvv: 721	178: Record<string, number> = { jffnwhusn: 341, kxslihfmn: 639, boyitlyeb: 534, arcczkszd: 891, efajgenat: 752, cbgfgfhop: 945	179: Record<string, number> = { deiiyrngi: 257, lfntspupg: 819, yqqkiamps: 102, mrslzievh: 573, ljvwzqeif: 433, pzfgiqfzw: 326
180: Record<string, number> = { hmhkeumsf: 43, pbanvtryd: 973, plvcfdcrg: 291, fyvjkdvkq: 201, czeqcyqca: 817, rqlquubta: 685	181: Record<string, number> = { powneqive: 144, cnshstxvq: 383, uzkvdgoom: 873, cvrhdlkvh: 605, bejccvjre: 112, lymzwbsdn: 763	182: Record<string, number> = { rztyiqutu: 688, gypthyhje: 917, tgqxztykn: 225, czdcazqal: 576, gdizcphir: 594, bvmhfngyi: 622	183: Record<string, number> = { regqmgwvx: 211, rvmjbqlyh: 292, auirnxobh: 37, bfkethpbs: 686, tmqgsjeuv: 20, ijrrhsdry: 551	184: Record<string, number> = { bpfieqbfu: 906, tvmrvwhbp: 163, yoaeyldjy: 940, xjwvdqtzf: 458, cexunkmwc: 882, qoklppavk: 106	185: Record<string, number> = { rchorjmwp: 154, nuubgotwo: 413, pdakjyqcv: 780, xcisqjbis: 616, lpibrpvkj: 30, gwwkohwan: 128	186: Record<string, number> = { tlzssxfjt: 407, mzfmgbbho: 22, hzgfwzhbe: 712, xtjpojzvx: 460, azfzycosw: 237, hnbrdqsjr: 38	187: Record<string, number> = { zkdidrxsi: 73, fpxexiuls: 485, msvjabwlj: 901, ecsomgkqg: 343, fknhsdvhk: 899, kbdfoagyy: 358	188: Record<string, number> = { rfnhweqck: 178, weptrxtjq: 244, bwjmsopwt: 856, djridjbsb: 648, ecnucavgu: 658, qjiuwtkwe: 377	189: Record<string, number> = { dhtqozzsi: 338, sbvrtgydu: 682, zbwqthrwi: 393, gkzdavkfk: 378, kczocynno: 732, stozmppxx: 85
190: Record<string, number> = { eppstsved: 450, ubtmartma: 51, nrhylblqg: 840, picoqmljr: 139, qqnvhbnpe: 168, bhsokqcof: 393	191: Record<string, number> = { nmrocasii: 545, aofnrigec: 598, ilskhqauj: 411, emwrvaanx: 44, yhmrionzf: 815, rgrwbselq: 854	192: Record<string, number> = { pswbadwbw: 330, cxldtogmb: 466, mcvnlwphv: 747, rkgxsqdxg: 436, zjpngliyl: 964, ibfgldglv: 464	193: Record<string, number> = { ivtrcklgw: 949, jscriysbv: 1, ualnrndbq: 214, qfpuhzlha: 16, avtupcato: 251, ejpwzthvh: 604	194: Record<string, number> = { wanfkmped: 299, jhzqpumen: 913, htijgxzus: 510, xdqxyqlas: 740, jenqsxcni: 589, dnrnhbpfc: 436	195: Record<string, number> = { uoeljpsdp: 645, giyqxpffg: 988, oknxwnnhi: 570, kpxfuhnmm: 23, jftqxidwl: 429, ukduvgiug: 7	196: Record<string, number> = { ouppuekrj: 158, omumijonc: 644, gcowhycgu: 923, valipvkar: 11, bwvxqwane: 526, xngdqdpnj: 297	197: Record<string, number> = { wyurthhfz: 995, pnwyxnshs: 456, wihscqybl: 963, exvobiwvd: 469, wwmbsaekg: 420, cipybtjke: 346	198: Record<string, number> = { ankhxmijm: 108, qncibyyhx: 839, cilegbeoh: 96, hzblhvwpe: 360, zoehefggf: 816, yjtycecgz: 687	199: Record<string, number> = { xzibdtkum: 491, hhcjepcct: 959, xvelqzagk: 424, jafljpmyw: 599, mxfjjndrz: 134, xgvxczweo: 810`,
        (n, a, b, c, d, e, f, g, h, i, j) => `  const t${a} };
  all.push(t${10 * n});
  const t${b} };
  all.push(t${10 * n + 1});
  const t${c} };
  all.push(t${10 * n + 2});
  const t${d} };
  all.push(t${10 * n + 3});
  const t${e} };
  all.push(t${10 * n + 4});
  const t${f} };
  all.push(t${10 * n + 5});
  const t${g} };
  all.push(t${10 * n + 6});
  const t${h} };
  all.push(t${10 * n + 7});
  const t${i} };
  all.push(t${10 * n + 8});
  const t${j} };
  all.push(t${10 * n + 9});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    "lists-of-constants/tables-small-s6-same.ts": text(
      `// Lists of constants: tables small  same. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { spmwzsnj: 364, lsexwzyx: 959, bsihhrxv: 124, bdganxbw: 884, qqmgcyhw: 83, nhvatlas: 810	1: Record<string, number> = { spmwzsnj: 15, lsexwzyx: 544, bsihhrxv: 89, bdganxbw: 826, qqmgcyhw: 389, nhvatlas: 215	2: Record<string, number> = { spmwzsnj: 990, lsexwzyx: 843, bsihhrxv: 279, bdganxbw: 647, qqmgcyhw: 458, nhvatlas: 611	3: Record<string, number> = { spmwzsnj: 935, lsexwzyx: 316, bsihhrxv: 646, bdganxbw: 342, qqmgcyhw: 967, nhvatlas: 142	4: Record<string, number> = { spmwzsnj: 217, lsexwzyx: 405, bsihhrxv: 935, bdganxbw: 374, qqmgcyhw: 656, nhvatlas: 371	5: Record<string, number> = { spmwzsnj: 121, lsexwzyx: 346, bsihhrxv: 723, bdganxbw: 284, qqmgcyhw: 982, nhvatlas: 19	6: Record<string, number> = { spmwzsnj: 774, lsexwzyx: 900, bsihhrxv: 131, bdganxbw: 420, qqmgcyhw: 452, nhvatlas: 975	7: Record<string, number> = { spmwzsnj: 24, lsexwzyx: 476, bsihhrxv: 400, bdganxbw: 892, qqmgcyhw: 395, nhvatlas: 800	8: Record<string, number> = { spmwzsnj: 902, lsexwzyx: 191, bsihhrxv: 836, bdganxbw: 414, qqmgcyhw: 854, nhvatlas: 51	9: Record<string, number> = { spmwzsnj: 689, lsexwzyx: 960, bsihhrxv: 670, bdganxbw: 41, qqmgcyhw: 289, nhvatlas: 1
10: Record<string, number> = { spmwzsnj: 410, lsexwzyx: 785, bsihhrxv: 161, bdganxbw: 916, qqmgcyhw: 806, nhvatlas: 852	11: Record<string, number> = { spmwzsnj: 500, lsexwzyx: 604, bsihhrxv: 388, bdganxbw: 21, qqmgcyhw: 135, nhvatlas: 408	12: Record<string, number> = { spmwzsnj: 897, lsexwzyx: 680, bsihhrxv: 287, bdganxbw: 355, qqmgcyhw: 510, nhvatlas: 853	13: Record<string, number> = { spmwzsnj: 695, lsexwzyx: 138, bsihhrxv: 955, bdganxbw: 920, qqmgcyhw: 23, nhvatlas: 10	14: Record<string, number> = { spmwzsnj: 768, lsexwzyx: 400, bsihhrxv: 214, bdganxbw: 182, qqmgcyhw: 566, nhvatlas: 875	15: Record<string, number> = { spmwzsnj: 877, lsexwzyx: 279, bsihhrxv: 85, bdganxbw: 100, qqmgcyhw: 210, nhvatlas: 343	16: Record<string, number> = { spmwzsnj: 294, lsexwzyx: 388, bsihhrxv: 434, bdganxbw: 738, qqmgcyhw: 145, nhvatlas: 669	17: Record<string, number> = { spmwzsnj: 376, lsexwzyx: 274, bsihhrxv: 25, bdganxbw: 453, qqmgcyhw: 880, nhvatlas: 453	18: Record<string, number> = { spmwzsnj: 415, lsexwzyx: 675, bsihhrxv: 869, bdganxbw: 273, qqmgcyhw: 757, nhvatlas: 134	19: Record<string, number> = { spmwzsnj: 615, lsexwzyx: 471, bsihhrxv: 910, bdganxbw: 514, qqmgcyhw: 585, nhvatlas: 918
20: Record<string, number> = { spmwzsnj: 573, lsexwzyx: 25, bsihhrxv: 914, bdganxbw: 256, qqmgcyhw: 817, nhvatlas: 857	21: Record<string, number> = { spmwzsnj: 949, lsexwzyx: 263, bsihhrxv: 856, bdganxbw: 933, qqmgcyhw: 119, nhvatlas: 347	22: Record<string, number> = { spmwzsnj: 251, lsexwzyx: 637, bsihhrxv: 368, bdganxbw: 377, qqmgcyhw: 634, nhvatlas: 462	23: Record<string, number> = { spmwzsnj: 716, lsexwzyx: 548, bsihhrxv: 727, bdganxbw: 90, qqmgcyhw: 511, nhvatlas: 945	24: Record<string, number> = { spmwzsnj: 909, lsexwzyx: 356, bsihhrxv: 343, bdganxbw: 735, qqmgcyhw: 88, nhvatlas: 134	25: Record<string, number> = { spmwzsnj: 914, lsexwzyx: 263, bsihhrxv: 400, bdganxbw: 41, qqmgcyhw: 569, nhvatlas: 196	26: Record<string, number> = { spmwzsnj: 852, lsexwzyx: 675, bsihhrxv: 678, bdganxbw: 279, qqmgcyhw: 806, nhvatlas: 989	27: Record<string, number> = { spmwzsnj: 877, lsexwzyx: 598, bsihhrxv: 538, bdganxbw: 979, qqmgcyhw: 415, nhvatlas: 759	28: Record<string, number> = { spmwzsnj: 373, lsexwzyx: 375, bsihhrxv: 43, bdganxbw: 223, qqmgcyhw: 607, nhvatlas: 108	29: Record<string, number> = { spmwzsnj: 76, lsexwzyx: 395, bsihhrxv: 38, bdganxbw: 708, qqmgcyhw: 512, nhvatlas: 594
30: Record<string, number> = { spmwzsnj: 181, lsexwzyx: 469, bsihhrxv: 34, bdganxbw: 468, qqmgcyhw: 835, nhvatlas: 114	31: Record<string, number> = { spmwzsnj: 964, lsexwzyx: 153, bsihhrxv: 793, bdganxbw: 463, qqmgcyhw: 100, nhvatlas: 553	32: Record<string, number> = { spmwzsnj: 566, lsexwzyx: 583, bsihhrxv: 719, bdganxbw: 898, qqmgcyhw: 737, nhvatlas: 374	33: Record<string, number> = { spmwzsnj: 699, lsexwzyx: 315, bsihhrxv: 249, bdganxbw: 862, qqmgcyhw: 315, nhvatlas: 97	34: Record<string, number> = { spmwzsnj: 318, lsexwzyx: 220, bsihhrxv: 127, bdganxbw: 852, qqmgcyhw: 41, nhvatlas: 734	35: Record<string, number> = { spmwzsnj: 778, lsexwzyx: 573, bsihhrxv: 556, bdganxbw: 880, qqmgcyhw: 820, nhvatlas: 207	36: Record<string, number> = { spmwzsnj: 581, lsexwzyx: 490, bsihhrxv: 587, bdganxbw: 391, qqmgcyhw: 798, nhvatlas: 320	37: Record<string, number> = { spmwzsnj: 264, lsexwzyx: 636, bsihhrxv: 619, bdganxbw: 867, qqmgcyhw: 123, nhvatlas: 832	38: Record<string, number> = { spmwzsnj: 925, lsexwzyx: 234, bsihhrxv: 409, bdganxbw: 639, qqmgcyhw: 326, nhvatlas: 87	39: Record<string, number> = { spmwzsnj: 160, lsexwzyx: 19, bsihhrxv: 538, bdganxbw: 101, qqmgcyhw: 45, nhvatlas: 528
40: Record<string, number> = { spmwzsnj: 963, lsexwzyx: 969, bsihhrxv: 240, bdganxbw: 948, qqmgcyhw: 976, nhvatlas: 367	41: Record<string, number> = { spmwzsnj: 965, lsexwzyx: 777, bsihhrxv: 239, bdganxbw: 709, qqmgcyhw: 440, nhvatlas: 333	42: Record<string, number> = { spmwzsnj: 209, lsexwzyx: 909, bsihhrxv: 920, bdganxbw: 945, qqmgcyhw: 577, nhvatlas: 292	43: Record<string, number> = { spmwzsnj: 824, lsexwzyx: 346, bsihhrxv: 823, bdganxbw: 808, qqmgcyhw: 265, nhvatlas: 369	44: Record<string, number> = { spmwzsnj: 448, lsexwzyx: 455, bsihhrxv: 617, bdganxbw: 434, qqmgcyhw: 851, nhvatlas: 638	45: Record<string, number> = { spmwzsnj: 925, lsexwzyx: 464, bsihhrxv: 889, bdganxbw: 228, qqmgcyhw: 250, nhvatlas: 42	46: Record<string, number> = { spmwzsnj: 764, lsexwzyx: 710, bsihhrxv: 507, bdganxbw: 70, qqmgcyhw: 36, nhvatlas: 189	47: Record<string, number> = { spmwzsnj: 158, lsexwzyx: 653, bsihhrxv: 212, bdganxbw: 83, qqmgcyhw: 653, nhvatlas: 924	48: Record<string, number> = { spmwzsnj: 138, lsexwzyx: 213, bsihhrxv: 870, bdganxbw: 847, qqmgcyhw: 997, nhvatlas: 89	49: Record<string, number> = { spmwzsnj: 237, lsexwzyx: 645, bsihhrxv: 164, bdganxbw: 160, qqmgcyhw: 134, nhvatlas: 520
50: Record<string, number> = { spmwzsnj: 388, lsexwzyx: 150, bsihhrxv: 88, bdganxbw: 343, qqmgcyhw: 11, nhvatlas: 307	51: Record<string, number> = { spmwzsnj: 608, lsexwzyx: 914, bsihhrxv: 214, bdganxbw: 972, qqmgcyhw: 525, nhvatlas: 497	52: Record<string, number> = { spmwzsnj: 291, lsexwzyx: 238, bsihhrxv: 811, bdganxbw: 223, qqmgcyhw: 595, nhvatlas: 413	53: Record<string, number> = { spmwzsnj: 762, lsexwzyx: 460, bsihhrxv: 741, bdganxbw: 202, qqmgcyhw: 173, nhvatlas: 308	54: Record<string, number> = { spmwzsnj: 334, lsexwzyx: 772, bsihhrxv: 893, bdganxbw: 617, qqmgcyhw: 139, nhvatlas: 929	55: Record<string, number> = { spmwzsnj: 331, lsexwzyx: 189, bsihhrxv: 888, bdganxbw: 23, qqmgcyhw: 685, nhvatlas: 602	56: Record<string, number> = { spmwzsnj: 530, lsexwzyx: 832, bsihhrxv: 224, bdganxbw: 81, qqmgcyhw: 345, nhvatlas: 534	57: Record<string, number> = { spmwzsnj: 698, lsexwzyx: 447, bsihhrxv: 82, bdganxbw: 893, qqmgcyhw: 139, nhvatlas: 704	58: Record<string, number> = { spmwzsnj: 841, lsexwzyx: 10, bsihhrxv: 637, bdganxbw: 829, qqmgcyhw: 76, nhvatlas: 287	59: Record<string, number> = { spmwzsnj: 444, lsexwzyx: 478, bsihhrxv: 884, bdganxbw: 134, qqmgcyhw: 21, nhvatlas: 71
60: Record<string, number> = { spmwzsnj: 811, lsexwzyx: 650, bsihhrxv: 726, bdganxbw: 61, qqmgcyhw: 12, nhvatlas: 898	61: Record<string, number> = { spmwzsnj: 657, lsexwzyx: 589, bsihhrxv: 783, bdganxbw: 292, qqmgcyhw: 498, nhvatlas: 908	62: Record<string, number> = { spmwzsnj: 382, lsexwzyx: 46, bsihhrxv: 666, bdganxbw: 53, qqmgcyhw: 543, nhvatlas: 801	63: Record<string, number> = { spmwzsnj: 41, lsexwzyx: 96, bsihhrxv: 824, bdganxbw: 795, qqmgcyhw: 979, nhvatlas: 890	64: Record<string, number> = { spmwzsnj: 443, lsexwzyx: 298, bsihhrxv: 843, bdganxbw: 965, qqmgcyhw: 834, nhvatlas: 508	65: Record<string, number> = { spmwzsnj: 651, lsexwzyx: 946, bsihhrxv: 199, bdganxbw: 297, qqmgcyhw: 65, nhvatlas: 713	66: Record<string, number> = { spmwzsnj: 285, lsexwzyx: 29, bsihhrxv: 490, bdganxbw: 59, qqmgcyhw: 143, nhvatlas: 201	67: Record<string, number> = { spmwzsnj: 859, lsexwzyx: 816, bsihhrxv: 795, bdganxbw: 238, qqmgcyhw: 795, nhvatlas: 173	68: Record<string, number> = { spmwzsnj: 419, lsexwzyx: 708, bsihhrxv: 706, bdganxbw: 727, qqmgcyhw: 487, nhvatlas: 719	69: Record<string, number> = { spmwzsnj: 160, lsexwzyx: 584, bsihhrxv: 278, bdganxbw: 766, qqmgcyhw: 393, nhvatlas: 740
70: Record<string, number> = { spmwzsnj: 713, lsexwzyx: 312, bsihhrxv: 276, bdganxbw: 966, qqmgcyhw: 145, nhvatlas: 395	71: Record<string, number> = { spmwzsnj: 949, lsexwzyx: 902, bsihhrxv: 300, bdganxbw: 504, qqmgcyhw: 157, nhvatlas: 309	72: Record<string, number> = { spmwzsnj: 366, lsexwzyx: 46, bsihhrxv: 196, bdganxbw: 924, qqmgcyhw: 241, nhvatlas: 130	73: Record<string, number> = { spmwzsnj: 658, lsexwzyx: 932, bsihhrxv: 700, bdganxbw: 939, qqmgcyhw: 556, nhvatlas: 558	74: Record<string, number> = { spmwzsnj: 566, lsexwzyx: 722, bsihhrxv: 766, bdganxbw: 586, qqmgcyhw: 523, nhvatlas: 159	75: Record<string, number> = { spmwzsnj: 463, lsexwzyx: 122, bsihhrxv: 28, bdganxbw: 788, qqmgcyhw: 202, nhvatlas: 573	76: Record<string, number> = { spmwzsnj: 852, lsexwzyx: 292, bsihhrxv: 38, bdganxbw: 759, qqmgcyhw: 73, nhvatlas: 421	77: Record<string, number> = { spmwzsnj: 583, lsexwzyx: 105, bsihhrxv: 528, bdganxbw: 316, qqmgcyhw: 33, nhvatlas: 280	78: Record<string, number> = { spmwzsnj: 42, lsexwzyx: 694, bsihhrxv: 620, bdganxbw: 446, qqmgcyhw: 742, nhvatlas: 231	79: Record<string, number> = { spmwzsnj: 274, lsexwzyx: 946, bsihhrxv: 958, bdganxbw: 719, qqmgcyhw: 338, nhvatlas: 913
80: Record<string, number> = { spmwzsnj: 419, lsexwzyx: 826, bsihhrxv: 939, bdganxbw: 235, qqmgcyhw: 415, nhvatlas: 732	81: Record<string, number> = { spmwzsnj: 494, lsexwzyx: 533, bsihhrxv: 386, bdganxbw: 544, qqmgcyhw: 322, nhvatlas: 246	82: Record<string, number> = { spmwzsnj: 255, lsexwzyx: 89, bsihhrxv: 59, bdganxbw: 705, qqmgcyhw: 514, nhvatlas: 407	83: Record<string, number> = { spmwzsnj: 656, lsexwzyx: 96, bsihhrxv: 200, bdganxbw: 463, qqmgcyhw: 264, nhvatlas: 189	84: Record<string, number> = { spmwzsnj: 896, lsexwzyx: 740, bsihhrxv: 927, bdganxbw: 370, qqmgcyhw: 255, nhvatlas: 426	85: Record<string, number> = { spmwzsnj: 634, lsexwzyx: 464, bsihhrxv: 38, bdganxbw: 73, qqmgcyhw: 938, nhvatlas: 505	86: Record<string, number> = { spmwzsnj: 580, lsexwzyx: 302, bsihhrxv: 444, bdganxbw: 506, qqmgcyhw: 641, nhvatlas: 553	87: Record<string, number> = { spmwzsnj: 446, lsexwzyx: 134, bsihhrxv: 806, bdganxbw: 690, qqmgcyhw: 789, nhvatlas: 176	88: Record<string, number> = { spmwzsnj: 44, lsexwzyx: 9, bsihhrxv: 271, bdganxbw: 103, qqmgcyhw: 737, nhvatlas: 806	89: Record<string, number> = { spmwzsnj: 950, lsexwzyx: 314, bsihhrxv: 2, bdganxbw: 911, qqmgcyhw: 954, nhvatlas: 95
90: Record<string, number> = { spmwzsnj: 968, lsexwzyx: 66, bsihhrxv: 203, bdganxbw: 373, qqmgcyhw: 201, nhvatlas: 233	91: Record<string, number> = { spmwzsnj: 687, lsexwzyx: 600, bsihhrxv: 586, bdganxbw: 603, qqmgcyhw: 803, nhvatlas: 962	92: Record<string, number> = { spmwzsnj: 697, lsexwzyx: 543, bsihhrxv: 295, bdganxbw: 934, qqmgcyhw: 337, nhvatlas: 163	93: Record<string, number> = { spmwzsnj: 214, lsexwzyx: 19, bsihhrxv: 603, bdganxbw: 16, qqmgcyhw: 953, nhvatlas: 161	94: Record<string, number> = { spmwzsnj: 247, lsexwzyx: 416, bsihhrxv: 975, bdganxbw: 652, qqmgcyhw: 831, nhvatlas: 741	95: Record<string, number> = { spmwzsnj: 981, lsexwzyx: 492, bsihhrxv: 840, bdganxbw: 538, qqmgcyhw: 50, nhvatlas: 673	96: Record<string, number> = { spmwzsnj: 216, lsexwzyx: 255, bsihhrxv: 24, bdganxbw: 104, qqmgcyhw: 294, nhvatlas: 864	97: Record<string, number> = { spmwzsnj: 145, lsexwzyx: 323, bsihhrxv: 778, bdganxbw: 177, qqmgcyhw: 344, nhvatlas: 803	98: Record<string, number> = { spmwzsnj: 170, lsexwzyx: 310, bsihhrxv: 999, bdganxbw: 917, qqmgcyhw: 227, nhvatlas: 787	99: Record<string, number> = { spmwzsnj: 178, lsexwzyx: 810, bsihhrxv: 209, bdganxbw: 120, qqmgcyhw: 927, nhvatlas: 775
100: Record<string, number> = { spmwzsnj: 47, lsexwzyx: 635, bsihhrxv: 730, bdganxbw: 519, qqmgcyhw: 67, nhvatlas: 981	101: Record<string, number> = { spmwzsnj: 936, lsexwzyx: 808, bsihhrxv: 846, bdganxbw: 678, qqmgcyhw: 317, nhvatlas: 954	102: Record<string, number> = { spmwzsnj: 905, lsexwzyx: 585, bsihhrxv: 408, bdganxbw: 531, qqmgcyhw: 172, nhvatlas: 282	103: Record<string, number> = { spmwzsnj: 849, lsexwzyx: 858, bsihhrxv: 940, bdganxbw: 738, qqmgcyhw: 868, nhvatlas: 709	104: Record<string, number> = { spmwzsnj: 112, lsexwzyx: 136, bsihhrxv: 737, bdganxbw: 769, qqmgcyhw: 270, nhvatlas: 756	105: Record<string, number> = { spmwzsnj: 117, lsexwzyx: 595, bsihhrxv: 280, bdganxbw: 396, qqmgcyhw: 546, nhvatlas: 272	106: Record<string, number> = { spmwzsnj: 481, lsexwzyx: 216, bsihhrxv: 504, bdganxbw: 316, qqmgcyhw: 766, nhvatlas: 358	107: Record<string, number> = { spmwzsnj: 347, lsexwzyx: 525, bsihhrxv: 602, bdganxbw: 698, qqmgcyhw: 840, nhvatlas: 741	108: Record<string, number> = { spmwzsnj: 545, lsexwzyx: 894, bsihhrxv: 582, bdganxbw: 594, qqmgcyhw: 864, nhvatlas: 366	109: Record<string, number> = { spmwzsnj: 428, lsexwzyx: 975, bsihhrxv: 950, bdganxbw: 557, qqmgcyhw: 119, nhvatlas: 205
110: Record<string, number> = { spmwzsnj: 272, lsexwzyx: 98, bsihhrxv: 839, bdganxbw: 633, qqmgcyhw: 897, nhvatlas: 306	111: Record<string, number> = { spmwzsnj: 759, lsexwzyx: 719, bsihhrxv: 838, bdganxbw: 567, qqmgcyhw: 134, nhvatlas: 355	112: Record<string, number> = { spmwzsnj: 6, lsexwzyx: 248, bsihhrxv: 329, bdganxbw: 391, qqmgcyhw: 70, nhvatlas: 300	113: Record<string, number> = { spmwzsnj: 783, lsexwzyx: 196, bsihhrxv: 117, bdganxbw: 470, qqmgcyhw: 392, nhvatlas: 213	114: Record<string, number> = { spmwzsnj: 194, lsexwzyx: 413, bsihhrxv: 461, bdganxbw: 736, qqmgcyhw: 479, nhvatlas: 424	115: Record<string, number> = { spmwzsnj: 625, lsexwzyx: 71, bsihhrxv: 517, bdganxbw: 301, qqmgcyhw: 376, nhvatlas: 773	116: Record<string, number> = { spmwzsnj: 694, lsexwzyx: 862, bsihhrxv: 993, bdganxbw: 782, qqmgcyhw: 939, nhvatlas: 136	117: Record<string, number> = { spmwzsnj: 698, lsexwzyx: 426, bsihhrxv: 960, bdganxbw: 32, qqmgcyhw: 454, nhvatlas: 56	118: Record<string, number> = { spmwzsnj: 429, lsexwzyx: 882, bsihhrxv: 484, bdganxbw: 430, qqmgcyhw: 33, nhvatlas: 109	119: Record<string, number> = { spmwzsnj: 969, lsexwzyx: 225, bsihhrxv: 936, bdganxbw: 399, qqmgcyhw: 693, nhvatlas: 927
120: Record<string, number> = { spmwzsnj: 433, lsexwzyx: 262, bsihhrxv: 102, bdganxbw: 900, qqmgcyhw: 112, nhvatlas: 216	121: Record<string, number> = { spmwzsnj: 837, lsexwzyx: 504, bsihhrxv: 574, bdganxbw: 752, qqmgcyhw: 913, nhvatlas: 801	122: Record<string, number> = { spmwzsnj: 514, lsexwzyx: 561, bsihhrxv: 806, bdganxbw: 931, qqmgcyhw: 500, nhvatlas: 459	123: Record<string, number> = { spmwzsnj: 907, lsexwzyx: 595, bsihhrxv: 834, bdganxbw: 195, qqmgcyhw: 503, nhvatlas: 693	124: Record<string, number> = { spmwzsnj: 463, lsexwzyx: 99, bsihhrxv: 313, bdganxbw: 425, qqmgcyhw: 924, nhvatlas: 574	125: Record<string, number> = { spmwzsnj: 761, lsexwzyx: 898, bsihhrxv: 282, bdganxbw: 915, qqmgcyhw: 956, nhvatlas: 826	126: Record<string, number> = { spmwzsnj: 382, lsexwzyx: 283, bsihhrxv: 311, bdganxbw: 870, qqmgcyhw: 321, nhvatlas: 47	127: Record<string, number> = { spmwzsnj: 833, lsexwzyx: 823, bsihhrxv: 969, bdganxbw: 513, qqmgcyhw: 686, nhvatlas: 318	128: Record<string, number> = { spmwzsnj: 951, lsexwzyx: 482, bsihhrxv: 983, bdganxbw: 586, qqmgcyhw: 427, nhvatlas: 301	129: Record<string, number> = { spmwzsnj: 579, lsexwzyx: 547, bsihhrxv: 282, bdganxbw: 764, qqmgcyhw: 437, nhvatlas: 616
130: Record<string, number> = { spmwzsnj: 452, lsexwzyx: 812, bsihhrxv: 219, bdganxbw: 273, qqmgcyhw: 511, nhvatlas: 252	131: Record<string, number> = { spmwzsnj: 992, lsexwzyx: 854, bsihhrxv: 596, bdganxbw: 637, qqmgcyhw: 67, nhvatlas: 304	132: Record<string, number> = { spmwzsnj: 327, lsexwzyx: 335, bsihhrxv: 681, bdganxbw: 947, qqmgcyhw: 891, nhvatlas: 285	133: Record<string, number> = { spmwzsnj: 399, lsexwzyx: 967, bsihhrxv: 408, bdganxbw: 647, qqmgcyhw: 449, nhvatlas: 431	134: Record<string, number> = { spmwzsnj: 296, lsexwzyx: 473, bsihhrxv: 177, bdganxbw: 559, qqmgcyhw: 894, nhvatlas: 486	135: Record<string, number> = { spmwzsnj: 812, lsexwzyx: 860, bsihhrxv: 511, bdganxbw: 317, qqmgcyhw: 787, nhvatlas: 963	136: Record<string, number> = { spmwzsnj: 269, lsexwzyx: 978, bsihhrxv: 787, bdganxbw: 196, qqmgcyhw: 532, nhvatlas: 617	137: Record<string, number> = { spmwzsnj: 912, lsexwzyx: 816, bsihhrxv: 851, bdganxbw: 316, qqmgcyhw: 351, nhvatlas: 219	138: Record<string, number> = { spmwzsnj: 869, lsexwzyx: 784, bsihhrxv: 535, bdganxbw: 581, qqmgcyhw: 109, nhvatlas: 202	139: Record<string, number> = { spmwzsnj: 135, lsexwzyx: 169, bsihhrxv: 315, bdganxbw: 932, qqmgcyhw: 20, nhvatlas: 446
140: Record<string, number> = { spmwzsnj: 166, lsexwzyx: 896, bsihhrxv: 298, bdganxbw: 851, qqmgcyhw: 543, nhvatlas: 682	141: Record<string, number> = { spmwzsnj: 302, lsexwzyx: 885, bsihhrxv: 13, bdganxbw: 808, qqmgcyhw: 132, nhvatlas: 473	142: Record<string, number> = { spmwzsnj: 403, lsexwzyx: 571, bsihhrxv: 721, bdganxbw: 357, qqmgcyhw: 838, nhvatlas: 103	143: Record<string, number> = { spmwzsnj: 234, lsexwzyx: 362, bsihhrxv: 240, bdganxbw: 636, qqmgcyhw: 182, nhvatlas: 430	144: Record<string, number> = { spmwzsnj: 623, lsexwzyx: 324, bsihhrxv: 199, bdganxbw: 992, qqmgcyhw: 922, nhvatlas: 322	145: Record<string, number> = { spmwzsnj: 105, lsexwzyx: 486, bsihhrxv: 737, bdganxbw: 612, qqmgcyhw: 126, nhvatlas: 563	146: Record<string, number> = { spmwzsnj: 707, lsexwzyx: 939, bsihhrxv: 268, bdganxbw: 509, qqmgcyhw: 9, nhvatlas: 193	147: Record<string, number> = { spmwzsnj: 977, lsexwzyx: 292, bsihhrxv: 767, bdganxbw: 578, qqmgcyhw: 229, nhvatlas: 165	148: Record<string, number> = { spmwzsnj: 33, lsexwzyx: 954, bsihhrxv: 829, bdganxbw: 923, qqmgcyhw: 497, nhvatlas: 831	149: Record<string, number> = { spmwzsnj: 614, lsexwzyx: 256, bsihhrxv: 556, bdganxbw: 396, qqmgcyhw: 322, nhvatlas: 606
150: Record<string, number> = { spmwzsnj: 782, lsexwzyx: 910, bsihhrxv: 660, bdganxbw: 369, qqmgcyhw: 878, nhvatlas: 608	151: Record<string, number> = { spmwzsnj: 936, lsexwzyx: 665, bsihhrxv: 594, bdganxbw: 806, qqmgcyhw: 484, nhvatlas: 247	152: Record<string, number> = { spmwzsnj: 238, lsexwzyx: 460, bsihhrxv: 754, bdganxbw: 995, qqmgcyhw: 147, nhvatlas: 804	153: Record<string, number> = { spmwzsnj: 620, lsexwzyx: 169, bsihhrxv: 78, bdganxbw: 85, qqmgcyhw: 27, nhvatlas: 531	154: Record<string, number> = { spmwzsnj: 336, lsexwzyx: 348, bsihhrxv: 683, bdganxbw: 265, qqmgcyhw: 301, nhvatlas: 805	155: Record<string, number> = { spmwzsnj: 657, lsexwzyx: 370, bsihhrxv: 589, bdganxbw: 69, qqmgcyhw: 646, nhvatlas: 580	156: Record<string, number> = { spmwzsnj: 246, lsexwzyx: 373, bsihhrxv: 21, bdganxbw: 269, qqmgcyhw: 389, nhvatlas: 680	157: Record<string, number> = { spmwzsnj: 508, lsexwzyx: 560, bsihhrxv: 967, bdganxbw: 508, qqmgcyhw: 723, nhvatlas: 657	158: Record<string, number> = { spmwzsnj: 546, lsexwzyx: 675, bsihhrxv: 363, bdganxbw: 102, qqmgcyhw: 898, nhvatlas: 342	159: Record<string, number> = { spmwzsnj: 436, lsexwzyx: 280, bsihhrxv: 27, bdganxbw: 127, qqmgcyhw: 172, nhvatlas: 800
160: Record<string, number> = { spmwzsnj: 208, lsexwzyx: 262, bsihhrxv: 310, bdganxbw: 945, qqmgcyhw: 858, nhvatlas: 136	161: Record<string, number> = { spmwzsnj: 211, lsexwzyx: 10, bsihhrxv: 233, bdganxbw: 497, qqmgcyhw: 940, nhvatlas: 854	162: Record<string, number> = { spmwzsnj: 592, lsexwzyx: 972, bsihhrxv: 224, bdganxbw: 245, qqmgcyhw: 775, nhvatlas: 33	163: Record<string, number> = { spmwzsnj: 326, lsexwzyx: 694, bsihhrxv: 555, bdganxbw: 184, qqmgcyhw: 170, nhvatlas: 902	164: Record<string, number> = { spmwzsnj: 396, lsexwzyx: 769, bsihhrxv: 965, bdganxbw: 564, qqmgcyhw: 473, nhvatlas: 158	165: Record<string, number> = { spmwzsnj: 59, lsexwzyx: 702, bsihhrxv: 100, bdganxbw: 114, qqmgcyhw: 265, nhvatlas: 253	166: Record<string, number> = { spmwzsnj: 199, lsexwzyx: 255, bsihhrxv: 467, bdganxbw: 758, qqmgcyhw: 466, nhvatlas: 944	167: Record<string, number> = { spmwzsnj: 82, lsexwzyx: 619, bsihhrxv: 607, bdganxbw: 63, qqmgcyhw: 34, nhvatlas: 599	168: Record<string, number> = { spmwzsnj: 429, lsexwzyx: 781, bsihhrxv: 810, bdganxbw: 336, qqmgcyhw: 212, nhvatlas: 647	169: Record<string, number> = { spmwzsnj: 97, lsexwzyx: 312, bsihhrxv: 412, bdganxbw: 633, qqmgcyhw: 562, nhvatlas: 179
170: Record<string, number> = { spmwzsnj: 94, lsexwzyx: 288, bsihhrxv: 677, bdganxbw: 697, qqmgcyhw: 238, nhvatlas: 450	171: Record<string, number> = { spmwzsnj: 843, lsexwzyx: 909, bsihhrxv: 346, bdganxbw: 126, qqmgcyhw: 792, nhvatlas: 969	172: Record<string, number> = { spmwzsnj: 890, lsexwzyx: 994, bsihhrxv: 546, bdganxbw: 588, qqmgcyhw: 936, nhvatlas: 852	173: Record<string, number> = { spmwzsnj: 977, lsexwzyx: 990, bsihhrxv: 521, bdganxbw: 681, qqmgcyhw: 962, nhvatlas: 816	174: Record<string, number> = { spmwzsnj: 312, lsexwzyx: 328, bsihhrxv: 524, bdganxbw: 371, qqmgcyhw: 386, nhvatlas: 111	175: Record<string, number> = { spmwzsnj: 255, lsexwzyx: 811, bsihhrxv: 4, bdganxbw: 567, qqmgcyhw: 113, nhvatlas: 174	176: Record<string, number> = { spmwzsnj: 964, lsexwzyx: 607, bsihhrxv: 301, bdganxbw: 85, qqmgcyhw: 915, nhvatlas: 129	177: Record<string, number> = { spmwzsnj: 170, lsexwzyx: 698, bsihhrxv: 830, bdganxbw: 16, qqmgcyhw: 405, nhvatlas: 61	178: Record<string, number> = { spmwzsnj: 922, lsexwzyx: 251, bsihhrxv: 497, bdganxbw: 809, qqmgcyhw: 773, nhvatlas: 753	179: Record<string, number> = { spmwzsnj: 817, lsexwzyx: 595, bsihhrxv: 873, bdganxbw: 85, qqmgcyhw: 471, nhvatlas: 619
180: Record<string, number> = { spmwzsnj: 493, lsexwzyx: 203, bsihhrxv: 285, bdganxbw: 27, qqmgcyhw: 227, nhvatlas: 523	181: Record<string, number> = { spmwzsnj: 310, lsexwzyx: 939, bsihhrxv: 363, bdganxbw: 917, qqmgcyhw: 215, nhvatlas: 795	182: Record<string, number> = { spmwzsnj: 743, lsexwzyx: 199, bsihhrxv: 785, bdganxbw: 657, qqmgcyhw: 716, nhvatlas: 568	183: Record<string, number> = { spmwzsnj: 775, lsexwzyx: 116, bsihhrxv: 367, bdganxbw: 977, qqmgcyhw: 440, nhvatlas: 604	184: Record<string, number> = { spmwzsnj: 652, lsexwzyx: 288, bsihhrxv: 247, bdganxbw: 959, qqmgcyhw: 286, nhvatlas: 17	185: Record<string, number> = { spmwzsnj: 212, lsexwzyx: 995, bsihhrxv: 283, bdganxbw: 35, qqmgcyhw: 111, nhvatlas: 70	186: Record<string, number> = { spmwzsnj: 625, lsexwzyx: 656, bsihhrxv: 195, bdganxbw: 107, qqmgcyhw: 820, nhvatlas: 873	187: Record<string, number> = { spmwzsnj: 733, lsexwzyx: 400, bsihhrxv: 810, bdganxbw: 203, qqmgcyhw: 649, nhvatlas: 941	188: Record<string, number> = { spmwzsnj: 72, lsexwzyx: 409, bsihhrxv: 244, bdganxbw: 849, qqmgcyhw: 597, nhvatlas: 481	189: Record<string, number> = { spmwzsnj: 166, lsexwzyx: 986, bsihhrxv: 223, bdganxbw: 468, qqmgcyhw: 90, nhvatlas: 713
190: Record<string, number> = { spmwzsnj: 427, lsexwzyx: 720, bsihhrxv: 783, bdganxbw: 438, qqmgcyhw: 822, nhvatlas: 340	191: Record<string, number> = { spmwzsnj: 845, lsexwzyx: 4, bsihhrxv: 479, bdganxbw: 774, qqmgcyhw: 332, nhvatlas: 12	192: Record<string, number> = { spmwzsnj: 584, lsexwzyx: 6, bsihhrxv: 386, bdganxbw: 537, qqmgcyhw: 392, nhvatlas: 249	193: Record<string, number> = { spmwzsnj: 154, lsexwzyx: 933, bsihhrxv: 323, bdganxbw: 832, qqmgcyhw: 600, nhvatlas: 443	194: Record<string, number> = { spmwzsnj: 312, lsexwzyx: 827, bsihhrxv: 898, bdganxbw: 494, qqmgcyhw: 147, nhvatlas: 554	195: Record<string, number> = { spmwzsnj: 219, lsexwzyx: 843, bsihhrxv: 311, bdganxbw: 836, qqmgcyhw: 928, nhvatlas: 545	196: Record<string, number> = { spmwzsnj: 851, lsexwzyx: 476, bsihhrxv: 321, bdganxbw: 836, qqmgcyhw: 579, nhvatlas: 233	197: Record<string, number> = { spmwzsnj: 53, lsexwzyx: 710, bsihhrxv: 752, bdganxbw: 654, qqmgcyhw: 158, nhvatlas: 303	198: Record<string, number> = { spmwzsnj: 603, lsexwzyx: 384, bsihhrxv: 359, bdganxbw: 864, qqmgcyhw: 510, nhvatlas: 915	199: Record<string, number> = { spmwzsnj: 729, lsexwzyx: 473, bsihhrxv: 387, bdganxbw: 707, qqmgcyhw: 974, nhvatlas: 355`,
        (n, a, b, c, d, e, f, g, h, i, j) => `  const t${a} };
  all.push(t${10 * n});
  const t${b} };
  all.push(t${10 * n + 1});
  const t${c} };
  all.push(t${10 * n + 2});
  const t${d} };
  all.push(t${10 * n + 3});
  const t${e} };
  all.push(t${10 * n + 4});
  const t${f} };
  all.push(t${10 * n + 5});
  const t${g} };
  all.push(t${10 * n + 6});
  const t${h} };
  all.push(t${10 * n + 7});
  const t${i} };
  all.push(t${10 * n + 8});
  const t${j} };
  all.push(t${10 * n + 9});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    "lists-of-constants/tables-small-s8-different.ts": text(
      `// Lists of constants: tables small  different. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { dbtuotutn: 242, zbwnlwxtw: 727, ehilukdht: 941, akpzqcsnp: 901, oergyetms: 44, uvsxhquzk: 998, xhnpehglz: 659, sfqdxjysh: 575	1: Record<string, number> = { tekyfkxba: 283, bilmdbgqq: 175, hbwgnlicd: 401, vmgjysfqh: 498, hphhqcnxf: 500, cyfwiwotk: 371, erngcemmc: 965, pdhjmuzjn: 82	2: Record<string, number> = { ltrapiitg: 245, kquxwslxe: 113, gvlihnass: 131, zdxoxfvkn: 194, jzlmlyssf: 998, inzswrpdn: 418, oexbgycao: 326, ixqwajfxg: 674	3: Record<string, number> = { vkfrbcrnb: 826, wespkpuxi: 621, mgdzhyhll: 964, gaeilctat: 897, xvloijtsm: 977, iwhezdmxd: 561, tusiiyymq: 203, bjsydckhw: 80	4: Record<string, number> = { mcqclsgtp: 963, rsgnmjidh: 194, dscnkzgzo: 381, lxakpowkd: 830, gkiipufvd: 95, eyarngkot: 26, lzepzskne: 639, lpdlbixzu: 76	5: Record<string, number> = { klosfgyao: 363, jtpkbzvls: 681, ortrhozlq: 202, tccxmkdnn: 635, eccbjomgm: 160, ydidexlej: 717, tcnvmxmhc: 877, nknjxaohl: 874	6: Record<string, number> = { yakplwwto: 777, aikxcwnsx: 470, vfcyeakyy: 972, hwtssxtyx: 513, fzpyyksqs: 451, qxvcpspnn: 927, kbxcdejls: 582, bapzghehy: 337	7: Record<string, number> = { ofclelsbk: 405, kpmfwfmpk: 722, vgjgbhoqx: 106, kwukladde: 555, aiukqvjib: 65, qgykabzbu: 818, rltlfcxfh: 982, nvptonfaz: 619	8: Record<string, number> = { vjkxzxair: 668, uolsnahvg: 261, halnwvpmz: 641, kjhdvptys: 13, togbqskbf: 559, chjhtwack: 829, vqxzpaylc: 476, wpetnbwdl: 447	9: Record<string, number> = { joqaiozyn: 467, waxpqvxsw: 679, ppaqyzdxy: 52, ogvsxiyra: 263, rutjiwhlm: 669, nxvmlmyie: 756, qzbpuddlw: 923, boopuqqxx: 838
10: Record<string, number> = { iodantnhh: 538, spmspyuod: 41, gvgexwpcu: 817, wqizgwnxv: 227, ufvxmopte: 342, msaxwnoxu: 101, yrtaqcffl: 579, offkndhuj: 550	11: Record<string, number> = { tcsfhwxug: 48, gaxnwntsh: 218, ronuaxycv: 790, zowrvzlcj: 102, vmjysbsuh: 466, vuvkwuzea: 695, nibyhgjeg: 186, htrweftav: 39	12: Record<string, number> = { pzxoaxmgf: 717, wusyftjgy: 895, nwaidiknh: 847, kxgsnnoiq: 943, kqmbvkxsu: 337, vvhraeqtu: 608, dwcqqandl: 152, anyhlkvxt: 964	13: Record<string, number> = { bhsvtrcql: 950, jnkebdvmt: 669, ialaxctvl: 488, mkzuktcjz: 624, ubauvvlac: 527, netgwmuky: 212, tjcevnvca: 444, abwwsrcvj: 607	14: Record<string, number> = { dtlgjorjy: 620, zvgltqiyd: 698, suxymjxcj: 125, ltnprlync: 490, bkopthhts: 478, nlzrehoij: 154, kciwynusy: 219, trgvutshj: 683	15: Record<string, number> = { uxrbpuvcn: 257, kuopyxirl: 78, rcrmityln: 454, wbtdehscy: 507, cvdaiboxy: 227, okwivcrlj: 934, fwkjfddhg: 254, poasvqcqh: 235	16: Record<string, number> = { eqxeakhwg: 2, dwedkqdan: 476, pfnaiwhhs: 612, itlsxmjzy: 493, waivnsnnd: 188, qnjzyqtus: 661, sskqwxdue: 492, dsjnronzh: 815	17: Record<string, number> = { paslouxwi: 228, wpszghspm: 656, boizelxlu: 380, pdopabhuj: 336, yreqwuhws: 432, huilrjaib: 733, ywjhjxlot: 231, mlmvocecy: 121	18: Record<string, number> = { habhnhluq: 324, ihcaldhdc: 97, sfqldzkfe: 929, tnturevuk: 300, mfnovdqcn: 333, dzznvityc: 441, sccatqfol: 653, oruuwhogf: 647	19: Record<string, number> = { trtqisdze: 824, wdsiihqws: 839, ubiykzbfn: 65, jjgdrendd: 103, ggntktxmo: 975, jyrdjvsxc: 433, ovzhlwlwz: 26, zvrtzlljh: 917
20: Record<string, number> = { lfxajsulg: 271, bbsdrtosd: 421, mqeigeytd: 657, efzrfujvt: 988, zrreczcde: 416, pnempwses: 233, ojijcljnw: 954, rvhtnqvtb: 397	21: Record<string, number> = { zkzcprkbt: 256, busjkofsf: 143, utiluhhcd: 433, dueuiggqr: 129, qjqmkxpqo: 821, twoqxegog: 938, dnicbzgel: 140, sumispytc: 75	22: Record<string, number> = { hwsbvzzkd: 172, yallznxqp: 100, rsjetnpsy: 976, phifxsqim: 196, rsohuvhfx: 729, iqnlfdxeq: 901, ukvszygkm: 579, hacebrmwd: 111	23: Record<string, number> = { ialearkbx: 877, frjbkvztb: 226, wjrjhfmbb: 565, lblicfmon: 923, sbuhzmrio: 427, yfdggntvd: 876, yytbbdfec: 389, kxrlrpahi: 293	24: Record<string, number> = { brzlpdoot: 598, bhjsxevkg: 449, vcntumvgp: 397, ourcicrkj: 350, cltcthxgt: 431, ictskfgpr: 679, gosmulbgf: 559, nfcfkutsr: 477	25: Record<string, number> = { dusfhmlpj: 948, fcucxvoga: 531, sycmdcsxg: 318, qcoqkogsx: 561, vbgzfyect: 953, kxtsxolhy: 579, assvuhtyw: 230, jhdinoulx: 380	26: Record<string, number> = { pxlpijhfk: 516, glowuveub: 176, cmbdtehgm: 363, npxludtaw: 894, zpwtnfyde: 914, bcutqqcik: 869, sycjafhlj: 578, heayzdham: 280	27: Record<string, number> = { dauuqsgfo: 3, cqakywuvn: 146, ctxotgbgh: 703, zvgshtfil: 635, ztkzgklhe: 668, nardbuohu: 527, cclptujry: 255, hnnsikttm: 280	28: Record<string, number> = { vxcbstqzq: 531, sxuqzwuhb: 53, yxkxlpzvu: 808, zcvdgwtds: 877, sgtkuvpiv: 809, erliznyjb: 665, fxodndnvy: 496, pwmzzmsvk: 826	29: Record<string, number> = { fzqbqtiqk: 324, ymixvelos: 113, uypcmxfru: 311, lwkfcsztd: 386, adjaazkzp: 936, knfjnzipu: 156, zldhqpwta: 612, nnwhuhfmr: 561
30: Record<string, number> = { yusmmbdsr: 586, ardunumse: 136, nfylirfrc: 573, masuwwnkp: 521, bkcbeirfg: 227, tplqlhshj: 281, haybfiiuu: 501, hkzeqpdaz: 197	31: Record<string, number> = { dpvjqecjy: 958, csfwzqwwd: 499, vjkhgehsy: 514, zpbeoenon: 925, wmmhsyyvx: 781, buydlpxku: 685, dknxcidzm: 721, nfsoaelkg: 469	32: Record<string, number> = { ziabmmilk: 487, eqierxnna: 797, flmqaxpew: 58, dcipkibog: 25, cufkxgwcy: 343, lmkmuomdk: 812, hdzjtzbov: 593, tyuaepkwh: 689	33: Record<string, number> = { thcitqqlj: 297, wcgxnaodz: 484, hwongpyky: 434, dcwzmdrdl: 911, kimxksduo: 541, ieckmjpxm: 944, wwrpbtuqr: 115, hebtlxvvu: 252	34: Record<string, number> = { mksmqhcci: 540, aubxhnkkm: 742, jkirketnj: 260, ckcxnxscw: 461, sppdzavdq: 330, fxfiindby: 181, xzlbsmjwd: 491, xmnbbiqhz: 527	35: Record<string, number> = { wwuokpwbl: 566, pbrqfkfla: 30, sjcstegrl: 415, krwjuvlqh: 437, ajxaxrsli: 245, flfnslhaw: 696, ewowrpkdw: 272, bafpjxehd: 506	36: Record<string, number> = { tciehwnfa: 919, luiczegvi: 955, wrwjgupgx: 39, lxtssmssl: 101, fwvpcgvdj: 380, dtonanshh: 306, tzqtsxloi: 668, ifqcmbagk: 698	37: Record<string, number> = { nxsxdeukx: 709, ibjrhzvko: 411, uhgldrrfm: 584, dozamdzcq: 409, mrpsbtjox: 320, mjoboblxs: 387, etuknelmu: 793, vxyuqyenr: 589	38: Record<string, number> = { iyzxbezzo: 845, jjknqgkkz: 556, kbvjglaeb: 31, knlwdcndt: 932, yjiqkfgfa: 522, zzqxfhcxq: 88, vjicqztpk: 817, aerzskbyb: 923	39: Record<string, number> = { mazsxuxtv: 655, zjvrhbmfs: 190, agmxnzkmw: 864, ulkbtrvsf: 561, nxwyeiamq: 575, vtovxsmyj: 300, mxoixhnil: 210, gmrpewywb: 502
40: Record<string, number> = { lxljjvbar: 843, yevngpntn: 469, klyyymjaw: 477, riutuwovo: 252, zdgzjunri: 946, nljoudnbb: 418, qhprveafa: 301, laruphdkt: 594	41: Record<string, number> = { jxbwloeuc: 640, czruxeesb: 274, flbdtrpcx: 529, ewvpjlqec: 662, bmcnxojcs: 363, dusjiekcw: 563, yubemdlwy: 596, gscrfcdzz: 505	42: Record<string, number> = { aozdblldn: 46, fwcudhdvz: 858, bkrxvvpxa: 3, fjjjxkctm: 349, frpsrjuga: 87, nyluswosa: 356, fbcmquvqa: 206, fnmkgcccd: 833	43: Record<string, number> = { hwyvfvwps: 906, nopcjycul: 980, zikzzrwnu: 459, sjdvzjvcm: 260, vwswkawtr: 323, upvydcuzl: 723, lcltxadlt: 21, ankyraysn: 891	44: Record<string, number> = { eolqcvkbn: 992, uwhlrdpcc: 777, jyryeffnu: 548, ulfqijpcl: 405, oolhemkwh: 119, mwqwmfbbg: 702, oeyzxdgyp: 645, pttxzkxgp: 330	45: Record<string, number> = { peervedor: 620, zoeqivnnm: 107, cohoxgyig: 932, xzgjeszla: 34, swpzmevqr: 431, faavysyky: 852, yldoyjfxj: 427, ttywjrzrc: 755	46: Record<string, number> = { nyxzmpvgr: 356, iruwstdff: 643, gxozybiju: 208, fvsqqueer: 479, bhvbjtvha: 259, jyceqshto: 644, ekoeunlqv: 41, yelzxpoyc: 390	47: Record<string, number> = { sllqmcodj: 102, tdsvskpxv: 659, bkdwziovx: 496, uljulyxrn: 856, zdaroxekj: 108, jyxewzali: 471, qvjszgolb: 297, qowrcysbo: 606	48: Record<string, number> = { homwnieoq: 987, ddglautwq: 267, aprpwwmcm: 987, xcgsakrtt: 339, lyvhiasgq: 482, fniprwtlc: 180, ekcobymmu: 576, lnmnwoogl: 170	49: Record<string, number> = { nqhznzlff: 423, ndofebkft: 625, sktjzqtbe: 83, yoverznlg: 956, sixfppkmt: 290, hrsaakjfs: 733, smmpobrix: 61, mbwqlfpbv: 821
50: Record<string, number> = { ovxhjdtep: 361, qvklvpshm: 507, yxaxzxzua: 255, hpmdxzwuq: 511, uxkewrrcz: 99, evmzwuxfn: 91, bmbovpmhr: 81, zzemkmgnm: 649	51: Record<string, number> = { orfzoslll: 283, fsnzkukto: 457, tiltfkpsn: 459, onrmfafwe: 47, zyybnondz: 824, owfklxjbs: 795, lhsomyxbo: 427, aidoohqlp: 286	52: Record<string, number> = { sljpokkni: 878, cshkkvttw: 832, xnsxieejo: 411, cbbknpsiv: 152, ifrqusady: 817, xbpuoqnuu: 359, yekhfxvbj: 605, jvnkllnxs: 401	53: Record<string, number> = { piihersfd: 773, cltnmyoyk: 798, dratigwwn: 886, gmaorubdl: 22, utlkkzioz: 186, hmuvbtqum: 460, spwilxmqf: 602, lwlxilzjw: 133	54: Record<string, number> = { gvlbewuoj: 225, vwhflwidd: 335, egptoamvt: 916, pvzpjippf: 321, kncmfymmg: 896, udkyqbxxz: 407, nalwheoci: 182, vabfdghza: 825	55: Record<string, number> = { nmnjyhylu: 761, wizwgybnf: 246, ateiwpjyy: 967, mrubjbohs: 970, tzueirily: 301, ppsjuquqv: 158, nsgdoqdyl: 797, ixxfyemmy: 717	56: Record<string, number> = { xttlasmnz: 136, bjebkhvzs: 540, jetarkuri: 717, ghmmyuofj: 612, jnyflibld: 301, pwgsdjldc: 851, akotudolt: 403, aomgfxjff: 391	57: Record<string, number> = { spvitgbtg: 695, czutvruvx: 445, jwrlkvnqg: 327, egykccymp: 882, hrzuvxzcv: 475, textimaxe: 932, humswxydu: 594, ckmkpaitk: 337	58: Record<string, number> = { idlqzfgcy: 461, qhspxdfta: 489, rcqkkvzrj: 292, manbxsjbc: 708, ubxnxuwgp: 300, zgnisgyue: 971, limfrijog: 591, xofyiucgd: 811	59: Record<string, number> = { vxgvcqybw: 797, lgyozbmwp: 852, oqrwfdomm: 430, ycvrpkpsn: 932, kfbrcggmd: 122, jrozhyshp: 382, niwhczswd: 126, nctvuunuw: 436
60: Record<string, number> = { mcuipqpsn: 680, aaohzhvcg: 45, lfgyoorqi: 193, rogutgqmp: 317, qczmwvshk: 790, ipaegcumk: 53, fdrdkbxqi: 403, kldvichvu: 585	61: Record<string, number> = { cmgxbfrss: 445, hggkwgugl: 781, hdztewhey: 128, xxopqszhr: 329, lclccqjfj: 928, lqncmeqqa: 834, maaksteoi: 927, jstbvrdch: 359	62: Record<string, number> = { ewheighkw: 127, raygxmqxu: 291, twhbwasom: 198, jzggptxjy: 734, wdneslnpr: 374, dlfonfevc: 743, hhokleqes: 379, sppcbsnxv: 653	63: Record<string, number> = { vfflzrrcn: 556, qkkhgzfae: 410, xhdwdmoan: 422, apcscerdj: 399, cdqyoejqj: 93, neisktrdy: 889, sttylbaar: 690, ahqfudpyp: 672	64: Record<string, number> = { knujgbagj: 858, btuiyglaj: 835, whcybduja: 4, cykskvksx: 471, bhirzoxxi: 37, xxczdyisw: 716, gethpmpoc: 621, xbqkexasx: 189	65: Record<string, number> = { ghhporpdm: 403, fjnrxiakk: 628, jzcbvmgit: 831, azddtjqbd: 124, wsedibpyk: 371, ruvsjnfut: 970, gdezmnscy: 493, elpizivap: 536	66: Record<string, number> = { upguntoms: 294, utusabnhk: 28, zokvljuon: 678, asrkeiwqd: 221, zdurjxkua: 858, bcschhlqi: 28, zohmvbkvi: 639, mbzfycamc: 85	67: Record<string, number> = { ugloegmyv: 638, agmnbhndx: 251, hzvqnmuhh: 864, ukxczirul: 223, xhsapkjka: 194, otqcofybo: 850, vgtwmmtpu: 161, rlqgcohtm: 779	68: Record<string, number> = { oehirkubc: 493, beggbhjlk: 395, vdzlkybxo: 785, kegowyduc: 448, asmkgtvka: 134, vrviwateb: 958, oeyqfwrym: 974, pqxqejash: 157	69: Record<string, number> = { jithuimrm: 562, hnjikdchw: 402, jhztshzoe: 873, mnmugxlui: 66, wkqvawvto: 268, uppgeglxx: 165, zvvpmkjsh: 605, jhvnjfkcu: 141
70: Record<string, number> = { kbcqvrmmy: 267, iubjhomor: 90, cveldqtqb: 23, bzvkkilgi: 705, ctjywfdal: 768, nbhvvomry: 316, huaomdpue: 620, qlofspucy: 83	71: Record<string, number> = { xclmiscml: 643, ajuabyoxe: 912, fgjipdmpg: 720, wnaldfjhg: 743, wzfdsqipx: 180, zhdscwmla: 990, vbazavcnp: 991, ziygjakwh: 551	72: Record<string, number> = { wgwejwhnv: 612, szsoyxqre: 720, xntiobzjz: 938, wnevhqwug: 89, zlrjjhvmz: 497, ivsohlcqd: 756, wdgjdjskb: 955, qxyfwntpo: 576	73: Record<string, number> = { qvgxdydwd: 88, dafcdttjb: 392, czgflkyev: 692, qtzennbgr: 53, pjlvwimdc: 278, dhaxnjjje: 200, wxhkaqnyj: 879, zkvzvmrws: 407	74: Record<string, number> = { lbiewpxej: 587, fpaoyxflw: 627, zrflrlnbu: 447, eksqgbdfy: 565, bocikxzdy: 849, ssdkjpxbq: 179, tkpvymppz: 544, idsknnxrf: 226	75: Record<string, number> = { xjtxuiwiz: 977, mdgenhhuu: 709, bfhugjfsw: 414, fwpmdihqm: 86, aqbshmxsj: 440, flgidcrds: 25, vrhvrqiji: 739, itsgeyoko: 870	76: Record<string, number> = { qswvzqpfc: 29, gswrojbjs: 953, tegtuxjxq: 97, wfutjlhpa: 73, mivqxzrrf: 345, qhabgyvuy: 855, gytyhphtm: 754, fisnpuyvp: 882	77: Record<string, number> = { pgjpvhfva: 407, cbjheqasp: 757, hmutzhffz: 432, byjhgdlvu: 590, ulooczzyu: 110, pvrpjzhha: 563, trtxrnlsx: 333, pmeizjzff: 607	78: Record<string, number> = { pomdgcufk: 199, csfgchccr: 983, hpwuytwje: 503, njgixlafh: 195, auookpgoh: 920, pilnvsxos: 674, jieqlsguz: 363, pziwutvom: 560	79: Record<string, number> = { uwyploovi: 657, hggawdjxb: 738, yekwcksdj: 832, xfirnhyls: 180, xxtovneyc: 314, shtciscxy: 779, ajxczytjt: 808, jitpudcxg: 594
80: Record<string, number> = { xzqdcrztp: 148, devuslyss: 925, wrpsucewn: 110, yunjhlipl: 867, wftaqgyhz: 757, qutusdegq: 184, ltnpvxalt: 650, ihtqskwog: 158	81: Record<string, number> = { pkyvsluic: 60, tmugphzzy: 580, grxcalizi: 454, ighnbzdbw: 583, qcwnczpqt: 277, ufzcelibk: 446, dfqdjafqx: 895, uhakizetf: 361	82: Record<string, number> = { obsomgoog: 29, hppqtuwxz: 889, picvdtybn: 211, rgepzinep: 240, psnafrjqh: 364, bqbsasacv: 339, bsxewjohd: 669, mhhlwtldf: 89	83: Record<string, number> = { lmskvsiay: 776, dmxhrfbdb: 357, woevskyjx: 110, ssaltffdk: 178, agyjgtzkw: 949, iwtqspxbg: 426, jbnltoahm: 357, zzglcpmsu: 636	84: Record<string, number> = { zjjsngphz: 630, terqzpwzs: 831, fsjjfguni: 17, ghlblpbjx: 860, brskgpgpk: 997, hlpmdgmdn: 85, kevetdeqw: 324, hsilzfxiy: 127	85: Record<string, number> = { qasblarpu: 128, ktufkeelj: 765, ulrgqihqz: 585, gaomdxoio: 416, pqmypgwhp: 883, preyesgvm: 247, drllxngum: 735, bargmmwvi: 378	86: Record<string, number> = { ciegiqgck: 722, agpshxdpw: 225, ezslqduht: 343, zyhdzmipr: 879, iglpljqve: 559, prupmvzwt: 995, aqvaeanil: 184, bozsbrjqc: 194	87: Record<string, number> = { prfuaumgg: 271, aatldpggq: 243, hteitgxpn: 297, krhlogoks: 777, wfhrjxnap: 642, lfpblzklq: 7, eqeiysnqp: 553, ganntqmmg: 881	88: Record<string, number> = { gkiwudjgr: 51, otkybhrkj: 394, bklnnepsi: 359, paksyjltr: 948, nurkqnuij: 441, klsogecyh: 747, fgstndygc: 295, dpmutvxuo: 521	89: Record<string, number> = { ulqvljobb: 801, axqlyadui: 789, yxhgxzwlr: 69, dcmjayypc: 266, vjkhnaauw: 542, ewnnidrvo: 423, nmytxiiul: 34, huxyyvdvq: 841
90: Record<string, number> = { zwxsaryez: 84, kfvprirgs: 320, qpqkafbak: 700, oulnooirq: 707, awmezkbfm: 23, xfkyizsew: 176, gbkswkgve: 27, jzwnznout: 773	91: Record<string, number> = { vdprwqhhg: 965, leiuaazwx: 447, dvxclsbaq: 251, melxyewwe: 439, toaeaimro: 860, eitvlmadj: 246, svuwmzmtm: 675, ittbtgunu: 443	92: Record<string, number> = { qatmhzpod: 905, zdgrqjakk: 510, kkddrqtwi: 249, roiolpnxg: 373, lyaatjeid: 802, ceifmsexn: 796, zycskqzkm: 756, mvalchxos: 882	93: Record<string, number> = { zwxxedwdg: 193, mbcekaavi: 941, csdhdlnla: 7, ibmgmlzfn: 932, wqfowchqf: 555, tqlyqddsk: 107, jzefpaqxf: 586, oxuknxshn: 212	94: Record<string, number> = { nizgjnhay: 226, lqtkjkeus: 220, tzfgvepgf: 415, qofzkppkn: 237, rwikkwnke: 558, fhdyqhqnj: 620, qqcfdtity: 73, naoirdbqb: 837	95: Record<string, number> = { jpqvvdkra: 864, crwoixqzy: 192, nvdwogqgr: 87, khnejsivz: 785, dgvbqzdlb: 540, fhjmoonrf: 339, jwujbfrfi: 201, mrqikkzxm: 310	96: Record<string, number> = { hxrjnbipy: 697, gtglmqlly: 661, tjnohrkmy: 842, hlsqtmcsh: 407, zmvkqnpcs: 938, kqlcvrtpn: 845, keoicjykm: 597, anrqaianf: 695	97: Record<string, number> = { hcicurwhk: 32, izuzylkge: 740, aybnrxlvf: 810, lhezwqsvr: 552, nlsibtgwy: 30, pgaifdblh: 546, lhaessxwo: 608, dkssbgvof: 510	98: Record<string, number> = { uselzagsw: 521, nrdzxmlvz: 226, aykwopceb: 93, tbbstmnil: 698, bxsygpefr: 935, kisztahjr: 701, hbzduwwlv: 940, fosrmlyjc: 748	99: Record<string, number> = { qvqfoxhns: 84, sttrlsiix: 840, ukhswzeru: 182, dhxmkjsqx: 261, qjyhkxelk: 324, wbflaqtro: 258, vwisnrshx: 818, esqzlxvup: 819
100: Record<string, number> = { fazvwapyx: 483, yqjfdbwmk: 692, nmajfyqpo: 917, inpcrspfv: 206, ngagkkkav: 22, kethdmwna: 345, tsvlvzauo: 602, ouazvwsoe: 873	101: Record<string, number> = { iznpwnzln: 282, oxybnibod: 267, qjdyzyfgh: 157, xizyjrhtc: 855, lgptsypob: 446, dgrmbcdzb: 630, mxvevcusl: 362, kpybtborl: 234	102: Record<string, number> = { xeglsgeut: 795, cwrjzdljq: 514, gvnktkmcz: 15, tpbtzftyq: 363, luzushght: 471, npklvnijh: 93, qnykacfih: 758, ptzrcbvcx: 410	103: Record<string, number> = { oghdukpgw: 197, surlxeqxw: 148, gsnfhfrvx: 166, hnpwgwdrq: 593, xkzwifzem: 758, icmjurity: 63, xkcyfyouf: 172, mptpjhare: 815	104: Record<string, number> = { rbrkhpque: 473, cclrclion: 796, gjcjcsgbd: 917, yflvztozl: 29, eizhfigmv: 210, cdzafcdgh: 144, abmfxrwxa: 479, qpjvogyqy: 175	105: Record<string, number> = { dppscqoaa: 556, ajdivxesc: 67, odgjvogcc: 309, njjtfkfpy: 934, oeoymwhig: 0, mvbnsutgx: 60, aemscvwiz: 855, cvzcxocag: 29	106: Record<string, number> = { ydnnzmjze: 548, inftwxcxv: 975, esnrzedtb: 29, djwkvuvor: 178, dztjtcvlh: 461, marhdvnyf: 562, ojlxtbavx: 677, smhdrdiun: 760	107: Record<string, number> = { vuekmgalb: 669, rheteegop: 454, ybbglyetb: 963, iccxtukrf: 718, eesjjoign: 341, rfjoskhoy: 62, ujfohwxsh: 212, stgoudqnj: 353	108: Record<string, number> = { eyyawcwov: 702, zenxczmlu: 79, hukaadupq: 321, ijlienfji: 186, ovbzokbdn: 109, ncjxzszmx: 728, nhtwjciha: 468, wquqlhmor: 727	109: Record<string, number> = { dkmmdxgcp: 982, zhtpsnsld: 853, prbmhmnno: 22, ovbqxszcq: 613, swwsnosvf: 511, dnxogatek: 708, fvjffofgl: 591, dsbodwmsl: 921
110: Record<string, number> = { xqgozwjpe: 882, ctrfaykwk: 491, rceebjdbv: 706, rdmdpobtv: 605, krgqdhmnn: 461, wiwidajoi: 571, lklmbukqj: 145, kzxpfjnqn: 991	111: Record<string, number> = { ycvdwuoop: 249, pmvpssmbl: 301, ldkogkxia: 270, xksngzrgm: 249, hlywekiyy: 707, wsuccsqjc: 510, brzbacunw: 380, jyybmdpyd: 43	112: Record<string, number> = { skpagrzpo: 983, mmjlwegek: 899, ijodshpys: 750, bsvdihidu: 803, rbakaiwbd: 892, ppacacozy: 181, yyvyskcpj: 288, iberimqbo: 991	113: Record<string, number> = { hoobwlxwf: 837, krvrdqxxg: 69, bfgvumzgo: 478, nayuduzbf: 110, rhtriiuln: 748, uyqfonati: 244, tarxojtxz: 182, ulpwdcxcf: 272	114: Record<string, number> = { glclrnfxr: 73, lgllqjnnt: 629, oqmiwlqnl: 151, wjuigqvld: 270, lpbodeigu: 978, rehfcnomj: 30, lcqgqfpzl: 926, kdrlyrfbv: 477	115: Record<string, number> = { bxfzhvaji: 508, yaqjagabc: 111, yvfdwilwh: 254, zbjzddodk: 67, pvcxytbop: 760, bmtiueicr: 366, vymyxbkxa: 714, kkxgnmccz: 771	116: Record<string, number> = { giqxnopyv: 722, musrueojk: 741, aefmybnfb: 956, ctrxhsbqn: 458, cxegrjzqt: 551, hduahcsyi: 981, gvjhsdmcv: 18, grwiktaer: 574	117: Record<string, number> = { thgusbjpk: 188, cvfwytwrl: 866, tkcyufsie: 22, hgnpaplvv: 814, elegdsiat: 515, izrijmjej: 429, lybfkasdj: 579, atyofroth: 419	118: Record<string, number> = { xjuejveds: 598, nqmfdnzij: 803, lxipfqilb: 376, ydlazxblf: 654, qnxkudwms: 766, xllfvzguu: 890, eebyfetwk: 108, ioewrldxi: 684	119: Record<string, number> = { xepdpfvcx: 75, qhmhpukbz: 0, xskxcakkl: 274, ntskwxgco: 861, ublagjpxt: 300, jsfakhtat: 557, jcybyhvro: 894, bmxhqkvkn: 214
120: Record<string, number> = { djrmrulkt: 253, melubdpbq: 301, trbucaqij: 72, efjneputq: 209, kzcansypf: 964, jjvjxhpcf: 490, aenthbjjh: 592, mhprixcvp: 232	121: Record<string, number> = { barlwomnw: 2, xaeroidbi: 352, rutppzyqw: 172, cnkxdsuqz: 227, dlbitopzf: 245, vvwrlyjgn: 821, qlfgnhpro: 778, ibvtdjhkt: 592	122: Record<string, number> = { pzvbsugos: 873, lonhhwuzo: 412, xbrciprwv: 435, nrmteuevf: 572, rsacykfpm: 517, jhcalcnjw: 859, olmyfepqn: 465, twnamzuql: 377	123: Record<string, number> = { dossnhufl: 544, ztovkmwmk: 685, ogydngjej: 259, puwljntrj: 132, lpzgrxcxt: 135, flqezcsyw: 485, rewjveben: 332, ctzzqngrj: 219	124: Record<string, number> = { cnaihqxut: 811, tfwxyajar: 390, wduifjjkt: 157, yzmzjodib: 806, kkmftxfvk: 248, hkghyssqw: 934, rqdeohldg: 949, qezexcnvt: 129	125: Record<string, number> = { imngmaahy: 482, xamwpwejk: 296, kpoukjvfv: 530, hitfplltu: 71, gfjencrbs: 232, ytfryzmnx: 63, hjqbtdjbs: 279, lubdxbtnm: 444	126: Record<string, number> = { jkilowtwi: 239, kozooqlxl: 424, uwapugcso: 0, wcoljwsbd: 241, uhvgvpuwu: 812, ovfobxtfl: 607, tjcjijmtj: 116, bazzbyvgv: 613	127: Record<string, number> = { rcfbwuzyq: 851, jkqisasgu: 644, svnryvrfl: 755, stmlkcdtp: 616, fiotfrgxj: 439, djmnjyjfz: 128, pzdbepngx: 330, umhjrmcac: 320	128: Record<string, number> = { xwrsjfckn: 579, mzrwlyjwh: 763, khutfhdry: 104, fpzzpnfrw: 447, jmsmgisqx: 892, rodbplmkl: 946, nbybzbaib: 9, nhvfpytby: 421	129: Record<string, number> = { hcrhkolzy: 192, roxmergkd: 627, gcxvajgio: 438, yyznhaduq: 128, gaukpzwyx: 690, sjkgarzjr: 371, tkaybaaia: 176, daqzpfdta: 119
130: Record<string, number> = { kdijyxfey: 894, wpgotjqdh: 66, gnchqvuzf: 695, plchwbfuz: 936, ddzzyyhqf: 931, rmjdwbzlx: 194, bscecoqsh: 496, udbxvunis: 996	131: Record<string, number> = { jkyabakyh: 110, hhwgyznii: 668, ecykjqxxj: 903, rakmysinx: 804, hbxfcbrme: 100, pritbdtqd: 740, qiboqwkox: 343, brzejtuqm: 982	132: Record<string, number> = { vghhvbxgz: 962, orggzvltz: 427, wjgcvhwqo: 666, abqtpnpsf: 359, fyygokvxd: 51, ctmvrgtrr: 452, yiscvfles: 775, zzjbiltsn: 603	133: Record<string, number> = { etotechve: 210, iftioddpd: 182, vrxyjffej: 347, foefxjeie: 491, lpupxwats: 743, inhktumsm: 541, hbsftxvok: 648, nupnentop: 229	134: Record<string, number> = { pdfjkkkgk: 545, yfpjgqsom: 874, yllwavswt: 54, zkzmgdzmx: 953, ygezivclo: 61, gqsfpbrcc: 935, demfvghvw: 968, xtnuowwus: 243	135: Record<string, number> = { aegtylgrd: 531, zijcmumaj: 56, gchqhwepo: 291, dxoozwfst: 746, tbajvhfpa: 657, lzxholren: 975, eyolijrlh: 675, yjurlciwg: 643	136: Record<string, number> = { amyldlzex: 552, rfqlpzele: 264, ejyivzbue: 253, mmhqozntn: 967, bucgoernr: 807, qcmdvhsjx: 55, tbdxlhiec: 700, xiwhmxvzm: 480	137: Record<string, number> = { hyoevrgck: 793, mijrajdkm: 297, hrpoiaupw: 942, doyaaczrc: 570, lohqgbkgz: 890, bmqgofqir: 261, jddwujddu: 116, laahcpaay: 798	138: Record<string, number> = { flkpptpuc: 744, gmrksxiob: 641, mjhbzqolv: 586, okpmqqguw: 994, vhabbohnf: 464, zvmvalitn: 959, fbtqpvkvs: 701, bepnzpkgg: 555	139: Record<string, number> = { qrhyntaqe: 353, sazhhwqug: 148, kohsplkds: 203, tvatygpqf: 250, ftgfejvht: 614, dhueegznu: 339, ttgdowxhj: 137, xyezskrmz: 763
140: Record<string, number> = { pbhmyvmqh: 959, gxfnecwjx: 456, ubbgqrflh: 480, llzijcloo: 79, crmnlwtbw: 382, douacbxfk: 256, zrecvyzby: 952, hevmlfrrx: 537	141: Record<string, number> = { oqcnsxtor: 192, ewoicyxxk: 19, spyoxlshk: 809, qibcaxmnj: 353, fnfpjfuyp: 64, afbvbaius: 334, uaxoutfqw: 154, hcdmnkqhg: 278	142: Record<string, number> = { gkmbokawe: 333, xgskmrpoh: 112, dobjxbuos: 376, uzwqomwkz: 381, zwbsyxfzo: 780, ozygqltbr: 193, vuroxvvst: 619, ekddpppuw: 24	143: Record<string, number> = { dzpunoqno: 997, unfovnyuq: 658, yovtdtzag: 433, zagtsyvbm: 247, wghrerqds: 610, hxnzinysy: 550, nmmxfepru: 645, gkyoeomba: 397	144: Record<string, number> = { tpmeetzbz: 498, yitmkmumz: 367, liytdkroq: 51, euhvapbxj: 324, uaammtuew: 452, dmzuiyczl: 640, ihvhitogk: 274, fxdyzhmxw: 157	145: Record<string, number> = { rnbtpchbp: 927, bhwxvyxap: 915, cuxprbvdp: 924, sgqpnxsif: 560, ghvuewidf: 882, mxwykueio: 978, epcqmidqc: 385, jykykzcix: 554	146: Record<string, number> = { rtlxnkwfx: 217, wueswvzkc: 562, vfsckcswh: 572, nuycmueis: 661, mgtjzvcqk: 200, jvirsaxmo: 769, xyvewomym: 72, npwkgtkxo: 219	147: Record<string, number> = { fawzyajby: 89, ytvrzkmoa: 690, rtdcblptx: 550, vqqbdsoha: 439, tetkopdli: 228, igkevelip: 382, cvjupxfzs: 604, kemfbjenm: 72	148: Record<string, number> = { guntlbrot: 79, kidpmsjwc: 249, ecdgxldyv: 910, qxruujzqj: 320, xojlwzkke: 129, zssxjmsgc: 92, rncpegtio: 116, kxblozypz: 685	149: Record<string, number> = { zmwwsvrbm: 961, lzuaujuqs: 498, aoidqgwun: 21, syvdjxsik: 737, hsdwiyqpm: 829, bvaaxxngf: 680, ljtsohsrw: 564, zmyremlmy: 907`,
        (n, a, b, c, d, e, f, g, h, i, j) => `  const t${a} };
  all.push(t${10 * n});
  const t${b} };
  all.push(t${10 * n + 1});
  const t${c} };
  all.push(t${10 * n + 2});
  const t${d} };
  all.push(t${10 * n + 3});
  const t${e} };
  all.push(t${10 * n + 4});
  const t${f} };
  all.push(t${10 * n + 5});
  const t${g} };
  all.push(t${10 * n + 6});
  const t${h} };
  all.push(t${10 * n + 7});
  const t${i} };
  all.push(t${10 * n + 8});
  const t${j} };
  all.push(t${10 * n + 9});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    "lists-of-constants/tables-small-s8-same.ts": text(
      `// Lists of constants: tables small  same. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
const all: Record<string, number>[] = [];
function fill() {`,
      [
        `0: Record<string, number> = { kzlcfkdp: 386, edmzpmzo: 697, gmzcxopp: 148, kekakcyh: 837, jgktuvat: 910, djpzfudx: 662, tnbbdnxz: 55, bcfcutqq: 367	1: Record<string, number> = { kzlcfkdp: 534, edmzpmzo: 27, gmzcxopp: 268, kekakcyh: 618, jgktuvat: 68, djpzfudx: 514, tnbbdnxz: 624, bcfcutqq: 662	2: Record<string, number> = { kzlcfkdp: 571, edmzpmzo: 516, gmzcxopp: 482, kekakcyh: 237, jgktuvat: 255, djpzfudx: 885, tnbbdnxz: 455, bcfcutqq: 494	3: Record<string, number> = { kzlcfkdp: 977, edmzpmzo: 586, gmzcxopp: 904, kekakcyh: 858, jgktuvat: 377, djpzfudx: 205, tnbbdnxz: 888, bcfcutqq: 868	4: Record<string, number> = { kzlcfkdp: 192, edmzpmzo: 868, gmzcxopp: 993, kekakcyh: 475, jgktuvat: 698, djpzfudx: 590, tnbbdnxz: 646, bcfcutqq: 73	5: Record<string, number> = { kzlcfkdp: 979, edmzpmzo: 143, gmzcxopp: 317, kekakcyh: 479, jgktuvat: 495, djpzfudx: 927, tnbbdnxz: 609, bcfcutqq: 939	6: Record<string, number> = { kzlcfkdp: 303, edmzpmzo: 903, gmzcxopp: 106, kekakcyh: 914, jgktuvat: 252, djpzfudx: 383, tnbbdnxz: 922, bcfcutqq: 228	7: Record<string, number> = { kzlcfkdp: 334, edmzpmzo: 597, gmzcxopp: 897, kekakcyh: 914, jgktuvat: 715, djpzfudx: 921, tnbbdnxz: 496, bcfcutqq: 549	8: Record<string, number> = { kzlcfkdp: 887, edmzpmzo: 362, gmzcxopp: 572, kekakcyh: 371, jgktuvat: 973, djpzfudx: 700, tnbbdnxz: 638, bcfcutqq: 52	9: Record<string, number> = { kzlcfkdp: 424, edmzpmzo: 897, gmzcxopp: 827, kekakcyh: 161, jgktuvat: 737, djpzfudx: 79, tnbbdnxz: 85, bcfcutqq: 131
10: Record<string, number> = { kzlcfkdp: 591, edmzpmzo: 446, gmzcxopp: 125, kekakcyh: 542, jgktuvat: 870, djpzfudx: 678, tnbbdnxz: 740, bcfcutqq: 769	11: Record<string, number> = { kzlcfkdp: 646, edmzpmzo: 237, gmzcxopp: 510, kekakcyh: 216, jgktuvat: 49, djpzfudx: 909, tnbbdnxz: 51, bcfcutqq: 84	12: Record<string, number> = { kzlcfkdp: 366, edmzpmzo: 865, gmzcxopp: 147, kekakcyh: 645, jgktuvat: 700, djpzfudx: 175, tnbbdnxz: 770, bcfcutqq: 207	13: Record<string, number> = { kzlcfkdp: 807, edmzpmzo: 756, gmzcxopp: 183, kekakcyh: 393, jgktuvat: 61, djpzfudx: 344, tnbbdnxz: 746, bcfcutqq: 550	14: Record<string, number> = { kzlcfkdp: 85, edmzpmzo: 28, gmzcxopp: 954, kekakcyh: 787, jgktuvat: 732, djpzfudx: 300, tnbbdnxz: 907, bcfcutqq: 368	15: Record<string, number> = { kzlcfkdp: 25, edmzpmzo: 609, gmzcxopp: 214, kekakcyh: 152, jgktuvat: 133, djpzfudx: 693, tnbbdnxz: 254, bcfcutqq: 738	16: Record<string, number> = { kzlcfkdp: 150, edmzpmzo: 846, gmzcxopp: 388, kekakcyh: 915, jgktuvat: 602, djpzfudx: 730, tnbbdnxz: 628, bcfcutqq: 198	17: Record<string, number> = { kzlcfkdp: 174, edmzpmzo: 49, gmzcxopp: 974, kekakcyh: 508, jgktuvat: 590, djpzfudx: 794, tnbbdnxz: 130, bcfcutqq: 679	18: Record<string, number> = { kzlcfkdp: 131, edmzpmzo: 880, gmzcxopp: 955, kekakcyh: 465, jgktuvat: 672, djpzfudx: 921, tnbbdnxz: 592, bcfcutqq: 162	19: Record<string, number> = { kzlcfkdp: 501, edmzpmzo: 543, gmzcxopp: 937, kekakcyh: 956, jgktuvat: 594, djpzfudx: 458, tnbbdnxz: 925, bcfcutqq: 64
20: Record<string, number> = { kzlcfkdp: 387, edmzpmzo: 198, gmzcxopp: 628, kekakcyh: 141, jgktuvat: 336, djpzfudx: 957, tnbbdnxz: 598, bcfcutqq: 922	21: Record<string, number> = { kzlcfkdp: 559, edmzpmzo: 493, gmzcxopp: 54, kekakcyh: 237, jgktuvat: 715, djpzfudx: 99, tnbbdnxz: 574, bcfcutqq: 998	22: Record<string, number> = { kzlcfkdp: 932, edmzpmzo: 179, gmzcxopp: 933, kekakcyh: 837, jgktuvat: 359, djpzfudx: 688, tnbbdnxz: 401, bcfcutqq: 203	23: Record<string, number> = { kzlcfkdp: 750, edmzpmzo: 436, gmzcxopp: 893, kekakcyh: 896, jgktuvat: 93, djpzfudx: 145, tnbbdnxz: 697, bcfcutqq: 30	24: Record<string, number> = { kzlcfkdp: 153, edmzpmzo: 522, gmzcxopp: 434, kekakcyh: 229, jgktuvat: 705, djpzfudx: 295, tnbbdnxz: 796, bcfcutqq: 457	25: Record<string, number> = { kzlcfkdp: 143, edmzpmzo: 465, gmzcxopp: 741, kekakcyh: 528, jgktuvat: 471, djpzfudx: 597, tnbbdnxz: 457, bcfcutqq: 978	26: Record<string, number> = { kzlcfkdp: 226, edmzpmzo: 608, gmzcxopp: 44, kekakcyh: 530, jgktuvat: 119, djpzfudx: 928, tnbbdnxz: 426, bcfcutqq: 736	27: Record<string, number> = { kzlcfkdp: 719, edmzpmzo: 472, gmzcxopp: 411, kekakcyh: 545, jgktuvat: 122, djpzfudx: 872, tnbbdnxz: 4, bcfcutqq: 389	28: Record<string, number> = { kzlcfkdp: 158, edmzpmzo: 730, gmzcxopp: 85, kekakcyh: 278, jgktuvat: 424, djpzfudx: 944, tnbbdnxz: 390, bcfcutqq: 389	29: Record<string, number> = { kzlcfkdp: 335, edmzpmzo: 181, gmzcxopp: 247, kekakcyh: 29, jgktuvat: 575, djpzfudx: 283, tnbbdnxz: 96, bcfcutqq: 714
30: Record<string, number> = { kzlcfkdp: 799, edmzpmzo: 972, gmzcxopp: 830, kekakcyh: 210, jgktuvat: 685, djpzfudx: 325, tnbbdnxz: 363, bcfcutqq: 289	31: Record<string, number> = { kzlcfkdp: 550, edmzpmzo: 250, gmzcxopp: 369, kekakcyh: 43, jgktuvat: 867, djpzfudx: 584, tnbbdnxz: 70, bcfcutqq: 565	32: Record<string, number> = { kzlcfkdp: 748, edmzpmzo: 785, gmzcxopp: 653, kekakcyh: 461, jgktuvat: 699, djpzfudx: 606, tnbbdnxz: 427, bcfcutqq: 217	33: Record<string, number> = { kzlcfkdp: 890, edmzpmzo: 267, gmzcxopp: 165, kekakcyh: 277, jgktuvat: 737, djpzfudx: 670, tnbbdnxz: 712, bcfcutqq: 240	34: Record<string, number> = { kzlcfkdp: 765, edmzpmzo: 997, gmzcxopp: 767, kekakcyh: 3, jgktuvat: 942, djpzfudx: 935, tnbbdnxz: 533, bcfcutqq: 798	35: Record<string, number> = { kzlcfkdp: 528, edmzpmzo: 602, gmzcxopp: 604, kekakcyh: 710, jgktuvat: 644, djpzfudx: 42, tnbbdnxz: 764, bcfcutqq: 449	36: Record<string, number> = { kzlcfkdp: 294, edmzpmzo: 995, gmzcxopp: 567, kekakcyh: 752, jgktuvat: 520, djpzfudx: 36, tnbbdnxz: 981, bcfcutqq: 357	37: Record<string, number> = { kzlcfkdp: 24, edmzpmzo: 581, gmzcxopp: 131, kekakcyh: 608, jgktuvat: 745, djpzfudx: 136, tnbbdnxz: 251, bcfcutqq: 542	38: Record<string, number> = { kzlcfkdp: 145, edmzpmzo: 812, gmzcxopp: 886, kekakcyh: 525, jgktuvat: 658, djpzfudx: 850, tnbbdnxz: 904, bcfcutqq: 423	39: Record<string, number> = { kzlcfkdp: 729, edmzpmzo: 894, gmzcxopp: 906, kekakcyh: 276, jgktuvat: 106, djpzfudx: 520, tnbbdnxz: 224, bcfcutqq: 633
40: Record<string, number> = { kzlcfkdp: 756, edmzpmzo: 337, gmzcxopp: 787, kekakcyh: 350, jgktuvat: 840, djpzfudx: 261, tnbbdnxz: 94, bcfcutqq: 251	41: Record<string, number> = { kzlcfkdp: 418, edmzpmzo: 762, gmzcxopp: 393, kekakcyh: 63, jgktuvat: 129, djpzfudx: 781, tnbbdnxz: 20, bcfcutqq: 117	42: Record<string, number> = { kzlcfkdp: 683, edmzpmzo: 929, gmzcxopp: 827, kekakcyh: 191, jgktuvat: 406, djpzfudx: 753, tnbbdnxz: 119, bcfcutqq: 983	43: Record<string, number> = { kzlcfkdp: 64, edmzpmzo: 368, gmzcxopp: 187, kekakcyh: 95, jgktuvat: 520, djpzfudx: 143, tnbbdnxz: 279, bcfcutqq: 49	44: Record<string, number> = { kzlcfkdp: 698, edmzpmzo: 668, gmzcxopp: 363, kekakcyh: 854, jgktuvat: 864, djpzfudx: 502, tnbbdnxz: 483, bcfcutqq: 524	45: Record<string, number> = { kzlcfkdp: 175, edmzpmzo: 363, gmzcxopp: 281, kekakcyh: 326, jgktuvat: 489, djpzfudx: 457, tnbbdnxz: 225, bcfcutqq: 634	46: Record<string, number> = { kzlcfkdp: 714, edmzpmzo: 942, gmzcxopp: 52, kekakcyh: 734, jgktuvat: 786, djpzfudx: 836, tnbbdnxz: 899, bcfcutqq: 374	47: Record<string, number> = { kzlcfkdp: 839, edmzpmzo: 893, gmzcxopp: 459, kekakcyh: 944, jgktuvat: 920, djpzfudx: 163, tnbbdnxz: 739, bcfcutqq: 279	48: Record<string, number> = { kzlcfkdp: 138, edmzpmzo: 965, gmzcxopp: 761, kekakcyh: 893, jgktuvat: 373, djpzfudx: 750, tnbbdnxz: 411, bcfcutqq: 502	49: Record<string, number> = { kzlcfkdp: 993, edmzpmzo: 860, gmzcxopp: 659, kekakcyh: 520, jgktuvat: 275, djpzfudx: 146, tnbbdnxz: 787, bcfcutqq: 378
50: Record<string, number> = { kzlcfkdp: 775, edmzpmzo: 310, gmzcxopp: 765, kekakcyh: 989, jgktuvat: 961, djpzfudx: 747, tnbbdnxz: 626, bcfcutqq: 315	51: Record<string, number> = { kzlcfkdp: 514, edmzpmzo: 792, gmzcxopp: 725, kekakcyh: 280, jgktuvat: 809, djpzfudx: 531, tnbbdnxz: 306, bcfcutqq: 600	52: Record<string, number> = { kzlcfkdp: 866, edmzpmzo: 745, gmzcxopp: 523, kekakcyh: 20, jgktuvat: 801, djpzfudx: 692, tnbbdnxz: 398, bcfcutqq: 431	53: Record<string, number> = { kzlcfkdp: 776, edmzpmzo: 121, gmzcxopp: 507, kekakcyh: 245, jgktuvat: 214, djpzfudx: 2, tnbbdnxz: 892, bcfcutqq: 176	54: Record<string, number> = { kzlcfkdp: 898, edmzpmzo: 618, gmzcxopp: 558, kekakcyh: 778, jgktuvat: 723, djpzfudx: 44, tnbbdnxz: 49, bcfcutqq: 438	55: Record<string, number> = { kzlcfkdp: 502, edmzpmzo: 319, gmzcxopp: 770, kekakcyh: 494, jgktuvat: 56, djpzfudx: 963, tnbbdnxz: 213, bcfcutqq: 433	56: Record<string, number> = { kzlcfkdp: 187, edmzpmzo: 871, gmzcxopp: 846, kekakcyh: 329, jgktuvat: 0, djpzfudx: 761, tnbbdnxz: 278, bcfcutqq: 186	57: Record<string, number> = { kzlcfkdp: 850, edmzpmzo: 378, gmzcxopp: 553, kekakcyh: 787, jgktuvat: 527, djpzfudx: 413, tnbbdnxz: 906, bcfcutqq: 896	58: Record<string, number> = { kzlcfkdp: 18, edmzpmzo: 496, gmzcxopp: 899, kekakcyh: 559, jgktuvat: 35, djpzfudx: 186, tnbbdnxz: 981, bcfcutqq: 944	59: Record<string, number> = { kzlcfkdp: 443, edmzpmzo: 97, gmzcxopp: 892, kekakcyh: 994, jgktuvat: 168, djpzfudx: 441, tnbbdnxz: 139, bcfcutqq: 877
60: Record<string, number> = { kzlcfkdp: 523, edmzpmzo: 869, gmzcxopp: 404, kekakcyh: 933, jgktuvat: 931, djpzfudx: 769, tnbbdnxz: 429, bcfcutqq: 822	61: Record<string, number> = { kzlcfkdp: 310, edmzpmzo: 771, gmzcxopp: 341, kekakcyh: 343, jgktuvat: 64, djpzfudx: 797, tnbbdnxz: 753, bcfcutqq: 542	62: Record<string, number> = { kzlcfkdp: 310, edmzpmzo: 141, gmzcxopp: 482, kekakcyh: 83, jgktuvat: 898, djpzfudx: 582, tnbbdnxz: 54, bcfcutqq: 364	63: Record<string, number> = { kzlcfkdp: 52, edmzpmzo: 682, gmzcxopp: 916, kekakcyh: 11, jgktuvat: 828, djpzfudx: 288, tnbbdnxz: 474, bcfcutqq: 941	64: Record<string, number> = { kzlcfkdp: 698, edmzpmzo: 859, gmzcxopp: 788, kekakcyh: 274, jgktuvat: 489, djpzfudx: 519, tnbbdnxz: 988, bcfcutqq: 274	65: Record<string, number> = { kzlcfkdp: 591, edmzpmzo: 864, gmzcxopp: 230, kekakcyh: 236, jgktuvat: 42, djpzfudx: 804, tnbbdnxz: 216, bcfcutqq: 829	66: Record<string, number> = { kzlcfkdp: 275, edmzpmzo: 905, gmzcxopp: 859, kekakcyh: 995, jgktuvat: 378, djpzfudx: 300, tnbbdnxz: 585, bcfcutqq: 428	67: Record<string, number> = { kzlcfkdp: 978, edmzpmzo: 587, gmzcxopp: 83, kekakcyh: 380, jgktuvat: 706, djpzfudx: 793, tnbbdnxz: 971, bcfcutqq: 958	68: Record<string, number> = { kzlcfkdp: 313, edmzpmzo: 842, gmzcxopp: 735, kekakcyh: 876, jgktuvat: 815, djpzfudx: 259, tnbbdnxz: 689, bcfcutqq: 899	69: Record<string, number> = { kzlcfkdp: 223, edmzpmzo: 77, gmzcxopp: 907, kekakcyh: 154, jgktuvat: 147, djpzfudx: 263, tnbbdnxz: 339, bcfcutqq: 462
70: Record<string, number> = { kzlcfkdp: 980, edmzpmzo: 496, gmzcxopp: 955, kekakcyh: 257, jgktuvat: 169, djpzfudx: 160, tnbbdnxz: 869, bcfcutqq: 647	71: Record<string, number> = { kzlcfkdp: 679, edmzpmzo: 49, gmzcxopp: 80, kekakcyh: 70, jgktuvat: 225, djpzfudx: 332, tnbbdnxz: 961, bcfcutqq: 170	72: Record<string, number> = { kzlcfkdp: 436, edmzpmzo: 5, gmzcxopp: 744, kekakcyh: 619, jgktuvat: 245, djpzfudx: 359, tnbbdnxz: 239, bcfcutqq: 217	73: Record<string, number> = { kzlcfkdp: 860, edmzpmzo: 77, gmzcxopp: 367, kekakcyh: 44, jgktuvat: 52, djpzfudx: 283, tnbbdnxz: 865, bcfcutqq: 235	74: Record<string, number> = { kzlcfkdp: 427, edmzpmzo: 666, gmzcxopp: 880, kekakcyh: 238, jgktuvat: 509, djpzfudx: 725, tnbbdnxz: 994, bcfcutqq: 266	75: Record<string, number> = { kzlcfkdp: 784, edmzpmzo: 211, gmzcxopp: 498, kekakcyh: 894, jgktuvat: 394, djpzfudx: 459, tnbbdnxz: 580, bcfcutqq: 746	76: Record<string, number> = { kzlcfkdp: 412, edmzpmzo: 332, gmzcxopp: 122, kekakcyh: 834, jgktuvat: 473, djpzfudx: 645, tnbbdnxz: 238, bcfcutqq: 368	77: Record<string, number> = { kzlcfkdp: 834, edmzpmzo: 386, gmzcxopp: 708, kekakcyh: 721, jgktuvat: 571, djpzfudx: 908, tnbbdnxz: 648, bcfcutqq: 278	78: Record<string, number> = { kzlcfkdp: 506, edmzpmzo: 867, gmzcxopp: 399, kekakcyh: 681, jgktuvat: 229, djpzfudx: 203, tnbbdnxz: 452, bcfcutqq: 900	79: Record<string, number> = { kzlcfkdp: 645, edmzpmzo: 929, gmzcxopp: 706, kekakcyh: 186, jgktuvat: 974, djpzfudx: 54, tnbbdnxz: 918, bcfcutqq: 14
80: Record<string, number> = { kzlcfkdp: 669, edmzpmzo: 828, gmzcxopp: 971, kekakcyh: 372, jgktuvat: 480, djpzfudx: 371, tnbbdnxz: 51, bcfcutqq: 441	81: Record<string, number> = { kzlcfkdp: 760, edmzpmzo: 788, gmzcxopp: 802, kekakcyh: 827, jgktuvat: 924, djpzfudx: 530, tnbbdnxz: 894, bcfcutqq: 893	82: Record<string, number> = { kzlcfkdp: 424, edmzpmzo: 534, gmzcxopp: 628, kekakcyh: 933, jgktuvat: 908, djpzfudx: 159, tnbbdnxz: 258, bcfcutqq: 202	83: Record<string, number> = { kzlcfkdp: 720, edmzpmzo: 813, gmzcxopp: 357, kekakcyh: 134, jgktuvat: 151, djpzfudx: 370, tnbbdnxz: 286, bcfcutqq: 86	84: Record<string, number> = { kzlcfkdp: 212, edmzpmzo: 663, gmzcxopp: 525, kekakcyh: 749, jgktuvat: 545, djpzfudx: 613, tnbbdnxz: 999, bcfcutqq: 574	85: Record<string, number> = { kzlcfkdp: 301, edmzpmzo: 20, gmzcxopp: 253, kekakcyh: 23, jgktuvat: 858, djpzfudx: 965, tnbbdnxz: 110, bcfcutqq: 377	86: Record<string, number> = { kzlcfkdp: 396, edmzpmzo: 132, gmzcxopp: 270, kekakcyh: 242, jgktuvat: 114, djpzfudx: 632, tnbbdnxz: 398, bcfcutqq: 685	87: Record<string, number> = { kzlcfkdp: 485, edmzpmzo: 996, gmzcxopp: 876, kekakcyh: 327, jgktuvat: 578, djpzfudx: 499, tnbbdnxz: 24, bcfcutqq: 20	88: Record<string, number> = { kzlcfkdp: 753, edmzpmzo: 55, gmzcxopp: 78, kekakcyh: 616, jgktuvat: 636, djpzfudx: 9, tnbbdnxz: 998, bcfcutqq: 376	89: Record<string, number> = { kzlcfkdp: 500, edmzpmzo: 322, gmzcxopp: 170, kekakcyh: 556, jgktuvat: 27, djpzfudx: 568, tnbbdnxz: 498, bcfcutqq: 335
90: Record<string, number> = { kzlcfkdp: 13, edmzpmzo: 521, gmzcxopp: 122, kekakcyh: 181, jgktuvat: 435, djpzfudx: 644, tnbbdnxz: 703, bcfcutqq: 804	91: Record<string, number> = { kzlcfkdp: 675, edmzpmzo: 531, gmzcxopp: 518, kekakcyh: 982, jgktuvat: 981, djpzfudx: 7, tnbbdnxz: 466, bcfcutqq: 239	92: Record<string, number> = { kzlcfkdp: 713, edmzpmzo: 566, gmzcxopp: 253, kekakcyh: 778, jgktuvat: 744, djpzfudx: 994, tnbbdnxz: 954, bcfcutqq: 437	93: Record<string, number> = { kzlcfkdp: 440, edmzpmzo: 107, gmzcxopp: 217, kekakcyh: 753, jgktuvat: 459, djpzfudx: 82, tnbbdnxz: 938, bcfcutqq: 567	94: Record<string, number> = { kzlcfkdp: 268, edmzpmzo: 863, gmzcxopp: 988, kekakcyh: 520, jgktuvat: 358, djpzfudx: 352, tnbbdnxz: 638, bcfcutqq: 312	95: Record<string, number> = { kzlcfkdp: 263, edmzpmzo: 556, gmzcxopp: 816, kekakcyh: 551, jgktuvat: 167, djpzfudx: 480, tnbbdnxz: 232, bcfcutqq: 773	96: Record<string, number> = { kzlcfkdp: 976, edmzpmzo: 937, gmzcxopp: 218, kekakcyh: 653, jgktuvat: 144, djpzfudx: 727, tnbbdnxz: 118, bcfcutqq: 256	97: Record<string, number> = { kzlcfkdp: 200, edmzpmzo: 911, gmzcxopp: 105, kekakcyh: 883, jgktuvat: 794, djpzfudx: 103, tnbbdnxz: 575, bcfcutqq: 501	98: Record<string, number> = { kzlcfkdp: 37, edmzpmzo: 545, gmzcxopp: 996, kekakcyh: 870, jgktuvat: 626, djpzfudx: 318, tnbbdnxz: 616, bcfcutqq: 928	99: Record<string, number> = { kzlcfkdp: 851, edmzpmzo: 873, gmzcxopp: 117, kekakcyh: 408, jgktuvat: 868, djpzfudx: 453, tnbbdnxz: 818, bcfcutqq: 377
100: Record<string, number> = { kzlcfkdp: 89, edmzpmzo: 701, gmzcxopp: 782, kekakcyh: 46, jgktuvat: 147, djpzfudx: 335, tnbbdnxz: 703, bcfcutqq: 42	101: Record<string, number> = { kzlcfkdp: 762, edmzpmzo: 930, gmzcxopp: 453, kekakcyh: 981, jgktuvat: 835, djpzfudx: 723, tnbbdnxz: 678, bcfcutqq: 109	102: Record<string, number> = { kzlcfkdp: 110, edmzpmzo: 250, gmzcxopp: 240, kekakcyh: 640, jgktuvat: 156, djpzfudx: 234, tnbbdnxz: 503, bcfcutqq: 614	103: Record<string, number> = { kzlcfkdp: 269, edmzpmzo: 869, gmzcxopp: 72, kekakcyh: 680, jgktuvat: 611, djpzfudx: 372, tnbbdnxz: 56, bcfcutqq: 764	104: Record<string, number> = { kzlcfkdp: 623, edmzpmzo: 221, gmzcxopp: 860, kekakcyh: 614, jgktuvat: 586, djpzfudx: 944, tnbbdnxz: 661, bcfcutqq: 257	105: Record<string, number> = { kzlcfkdp: 896, edmzpmzo: 926, gmzcxopp: 282, kekakcyh: 446, jgktuvat: 597, djpzfudx: 979, tnbbdnxz: 336, bcfcutqq: 92	106: Record<string, number> = { kzlcfkdp: 825, edmzpmzo: 640, gmzcxopp: 819, kekakcyh: 47, jgktuvat: 950, djpzfudx: 158, tnbbdnxz: 122, bcfcutqq: 851	107: Record<string, number> = { kzlcfkdp: 782, edmzpmzo: 231, gmzcxopp: 661, kekakcyh: 916, jgktuvat: 319, djpzfudx: 48, tnbbdnxz: 231, bcfcutqq: 741	108: Record<string, number> = { kzlcfkdp: 792, edmzpmzo: 724, gmzcxopp: 148, kekakcyh: 149, jgktuvat: 922, djpzfudx: 969, tnbbdnxz: 504, bcfcutqq: 968	109: Record<string, number> = { kzlcfkdp: 612, edmzpmzo: 317, gmzcxopp: 846, kekakcyh: 583, jgktuvat: 777, djpzfudx: 726, tnbbdnxz: 627, bcfcutqq: 994
110: Record<string, number> = { kzlcfkdp: 402, edmzpmzo: 442, gmzcxopp: 564, kekakcyh: 736, jgktuvat: 308, djpzfudx: 928, tnbbdnxz: 793, bcfcutqq: 504	111: Record<string, number> = { kzlcfkdp: 970, edmzpmzo: 932, gmzcxopp: 484, kekakcyh: 38, jgktuvat: 647, djpzfudx: 638, tnbbdnxz: 895, bcfcutqq: 600	112: Record<string, number> = { kzlcfkdp: 65, edmzpmzo: 889, gmzcxopp: 468, kekakcyh: 4, jgktuvat: 254, djpzfudx: 30, tnbbdnxz: 112, bcfcutqq: 657	113: Record<string, number> = { kzlcfkdp: 505, edmzpmzo: 460, gmzcxopp: 281, kekakcyh: 813, jgktuvat: 33, djpzfudx: 489, tnbbdnxz: 214, bcfcutqq: 576	114: Record<string, number> = { kzlcfkdp: 285, edmzpmzo: 187, gmzcxopp: 694, kekakcyh: 596, jgktuvat: 554, djpzfudx: 760, tnbbdnxz: 919, bcfcutqq: 833	115: Record<string, number> = { kzlcfkdp: 500, edmzpmzo: 837, gmzcxopp: 532, kekakcyh: 559, jgktuvat: 316, djpzfudx: 29, tnbbdnxz: 247, bcfcutqq: 578	116: Record<string, number> = { kzlcfkdp: 243, edmzpmzo: 76, gmzcxopp: 562, kekakcyh: 982, jgktuvat: 845, djpzfudx: 600, tnbbdnxz: 129, bcfcutqq: 683	117: Record<string, number> = { kzlcfkdp: 726, edmzpmzo: 70, gmzcxopp: 532, kekakcyh: 354, jgktuvat: 13, djpzfudx: 426, tnbbdnxz: 898, bcfcutqq: 348	118: Record<string, number> = { kzlcfkdp: 251, edmzpmzo: 47, gmzcxopp: 811, kekakcyh: 883, jgktuvat: 869, djpzfudx: 810, tnbbdnxz: 445, bcfcutqq: 153	119: Record<string, number> = { kzlcfkdp: 293, edmzpmzo: 18, gmzcxopp: 437, kekakcyh: 815, jgktuvat: 571, djpzfudx: 341, tnbbdnxz: 604, bcfcutqq: 825
120: Record<string, number> = { kzlcfkdp: 326, edmzpmzo: 630, gmzcxopp: 14, kekakcyh: 15, jgktuvat: 706, djpzfudx: 331, tnbbdnxz: 656, bcfcutqq: 757	121: Record<string, number> = { kzlcfkdp: 950, edmzpmzo: 40, gmzcxopp: 641, kekakcyh: 135, jgktuvat: 596, djpzfudx: 410, tnbbdnxz: 172, bcfcutqq: 525	122: Record<string, number> = { kzlcfkdp: 844, edmzpmzo: 990, gmzcxopp: 382, kekakcyh: 160, jgktuvat: 892, djpzfudx: 750, tnbbdnxz: 148, bcfcutqq: 526	123: Record<string, number> = { kzlcfkdp: 818, edmzpmzo: 118, gmzcxopp: 639, kekakcyh: 562, jgktuvat: 108, djpzfudx: 694, tnbbdnxz: 256, bcfcutqq: 981	124: Record<string, number> = { kzlcfkdp: 485, edmzpmzo: 560, gmzcxopp: 86, kekakcyh: 839, jgktuvat: 921, djpzfudx: 167, tnbbdnxz: 853, bcfcutqq: 864	125: Record<string, number> = { kzlcfkdp: 262, edmzpmzo: 283, gmzcxopp: 153, kekakcyh: 189, jgktuvat: 199, djpzfudx: 75, tnbbdnxz: 880, bcfcutqq: 323	126: Record<string, number> = { kzlcfkdp: 166, edmzpmzo: 836, gmzcxopp: 939, kekakcyh: 117, jgktuvat: 7, djpzfudx: 456, tnbbdnxz: 522, bcfcutqq: 853	127: Record<string, number> = { kzlcfkdp: 13, edmzpmzo: 560, gmzcxopp: 349, kekakcyh: 412, jgktuvat: 418, djpzfudx: 483, tnbbdnxz: 368, bcfcutqq: 559	128: Record<string, number> = { kzlcfkdp: 408, edmzpmzo: 432, gmzcxopp: 349, kekakcyh: 256, jgktuvat: 877, djpzfudx: 563, tnbbdnxz: 661, bcfcutqq: 378	129: Record<string, number> = { kzlcfkdp: 241, edmzpmzo: 307, gmzcxopp: 107, kekakcyh: 907, jgktuvat: 406, djpzfudx: 159, tnbbdnxz: 313, bcfcutqq: 852
130: Record<string, number> = { kzlcfkdp: 479, edmzpmzo: 234, gmzcxopp: 249, kekakcyh: 996, jgktuvat: 33, djpzfudx: 904, tnbbdnxz: 901, bcfcutqq: 787	131: Record<string, number> = { kzlcfkdp: 435, edmzpmzo: 872, gmzcxopp: 228, kekakcyh: 74, jgktuvat: 855, djpzfudx: 78, tnbbdnxz: 237, bcfcutqq: 544	132: Record<string, number> = { kzlcfkdp: 879, edmzpmzo: 856, gmzcxopp: 478, kekakcyh: 825, jgktuvat: 2, djpzfudx: 579, tnbbdnxz: 826, bcfcutqq: 897	133: Record<string, number> = { kzlcfkdp: 632, edmzpmzo: 809, gmzcxopp: 473, kekakcyh: 798, jgktuvat: 88, djpzfudx: 895, tnbbdnxz: 364, bcfcutqq: 381	134: Record<string, number> = { kzlcfkdp: 51, edmzpmzo: 895, gmzcxopp: 280, kekakcyh: 586, jgktuvat: 797, djpzfudx: 323, tnbbdnxz: 477, bcfcutqq: 335	135: Record<string, number> = { kzlcfkdp: 512, edmzpmzo: 689, gmzcxopp: 845, kekakcyh: 192, jgktuvat: 906, djpzfudx: 519, tnbbdnxz: 372, bcfcutqq: 769	136: Record<string, number> = { kzlcfkdp: 827, edmzpmzo: 569, gmzcxopp: 351, kekakcyh: 301, jgktuvat: 665, djpzfudx: 936, tnbbdnxz: 394, bcfcutqq: 257	137: Record<string, number> = { kzlcfkdp: 901, edmzpmzo: 901, gmzcxopp: 685, kekakcyh: 883, jgktuvat: 693, djpzfudx: 481, tnbbdnxz: 789, bcfcutqq: 265	138: Record<string, number> = { kzlcfkdp: 83, edmzpmzo: 346, gmzcxopp: 929, kekakcyh: 992, jgktuvat: 325, djpzfudx: 204, tnbbdnxz: 182, bcfcutqq: 301	139: Record<string, number> = { kzlcfkdp: 689, edmzpmzo: 61, gmzcxopp: 922, kekakcyh: 396, jgktuvat: 263, djpzfudx: 7, tnbbdnxz: 712, bcfcutqq: 76
140: Record<string, number> = { kzlcfkdp: 762, edmzpmzo: 310, gmzcxopp: 442, kekakcyh: 682, jgktuvat: 5, djpzfudx: 961, tnbbdnxz: 697, bcfcutqq: 176	141: Record<string, number> = { kzlcfkdp: 849, edmzpmzo: 606, gmzcxopp: 707, kekakcyh: 879, jgktuvat: 672, djpzfudx: 46, tnbbdnxz: 53, bcfcutqq: 792	142: Record<string, number> = { kzlcfkdp: 409, edmzpmzo: 329, gmzcxopp: 978, kekakcyh: 264, jgktuvat: 679, djpzfudx: 606, tnbbdnxz: 152, bcfcutqq: 25	143: Record<string, number> = { kzlcfkdp: 736, edmzpmzo: 626, gmzcxopp: 73, kekakcyh: 938, jgktuvat: 762, djpzfudx: 796, tnbbdnxz: 588, bcfcutqq: 918	144: Record<string, number> = { kzlcfkdp: 58, edmzpmzo: 533, gmzcxopp: 456, kekakcyh: 130, jgktuvat: 389, djpzfudx: 955, tnbbdnxz: 258, bcfcutqq: 395	145: Record<string, number> = { kzlcfkdp: 944, edmzpmzo: 803, gmzcxopp: 280, kekakcyh: 622, jgktuvat: 519, djpzfudx: 362, tnbbdnxz: 739, bcfcutqq: 194	146: Record<string, number> = { kzlcfkdp: 665, edmzpmzo: 991, gmzcxopp: 665, kekakcyh: 469, jgktuvat: 973, djpzfudx: 807, tnbbdnxz: 429, bcfcutqq: 84	147: Record<string, number> = { kzlcfkdp: 904, edmzpmzo: 423, gmzcxopp: 93, kekakcyh: 740, jgktuvat: 648, djpzfudx: 958, tnbbdnxz: 325, bcfcutqq: 300	148: Record<string, number> = { kzlcfkdp: 668, edmzpmzo: 995, gmzcxopp: 211, kekakcyh: 521, jgktuvat: 492, djpzfudx: 399, tnbbdnxz: 878, bcfcutqq: 100	149: Record<string, number> = { kzlcfkdp: 125, edmzpmzo: 834, gmzcxopp: 473, kekakcyh: 722, jgktuvat: 972, djpzfudx: 74, tnbbdnxz: 335, bcfcutqq: 572`,
        (n, a, b, c, d, e, f, g, h, i, j) => `  const t${a} };
  all.push(t${10 * n});
  const t${b} };
  all.push(t${10 * n + 1});
  const t${c} };
  all.push(t${10 * n + 2});
  const t${d} };
  all.push(t${10 * n + 3});
  const t${e} };
  all.push(t${10 * n + 4});
  const t${f} };
  all.push(t${10 * n + 5});
  const t${g} };
  all.push(t${10 * n + 6});
  const t${h} };
  all.push(t${10 * n + 7});
  const t${i} };
  all.push(t${10 * n + 8});
  const t${j} };
  all.push(t${10 * n + 9});`,
      ],
      `}
if (process.argv[2]) fill();
console.log(all.length);
`,
    ),
    ...untypedTwins("kept-attacks", "js", ["closures-that-are-lent/builtins"]),
    "a-round-through-the-language/s1-saturation.js": text(
      `// A round through the language, one probe of many. It prints what plain Bun prints.
function show(label, f) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", e?.name ?? String(e)); }
}
const O = { x: 1 };`,
      [80, n => `function f${n}(p) { return p.x + ${n}; }`],
      `let open = 0;`,
      [80, n => `open += f${n}(O);`],
      `console.log("open", open);
const list = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35, f36, f37, f38, f39, f40, f41, f42, f43, f44, f45, f46, f47, f48, f49, f50, f51, f52, f53, f54, f55, f56, f57, f58, f59, f60, f61, f62, f63, f64, f65, f66, f67, f68, f69, f70, f71, f72, f73, f74, f75, f76, f77, f78, f79];
show("list-str", () => list.map((f) => f("s")).join());
show("list-num", () => list.map((f) => f(5)).join());
const holder = {k0: f0, k1: f1, k2: f2, k3: f3, k4: f4, k5: f5, k6: f6, k7: f7, k8: f8, k9: f9, k10: f10, k11: f11, k12: f12, k13: f13, k14: f14, k15: f15, k16: f16, k17: f17, k18: f18, k19: f19, k20: f20, k21: f21, k22: f22, k23: f23, k24: f24, k25: f25, k26: f26, k27: f27, k28: f28, k29: f29, k30: f30, k31: f31, k32: f32, k33: f33, k34: f34, k35: f35, k36: f36, k37: f37, k38: f38, k39: f39, k40: f40, k41: f41, k42: f42, k43: f43, k44: f44, k45: f45, k46: f46, k47: f47, k48: f48, k49: f49, k50: f50, k51: f51, k52: f52, k53: f53, k54: f54, k55: f55, k56: f56, k57: f57, k58: f58, k59: f59, k60: f60, k61: f61, k62: f62, k63: f63, k64: f64, k65: f65, k66: f66, k67: f67, k68: f68, k69: f69, k70: f70, k71: f71, k72: f72, k73: f73, k74: f74, k75: f75, k76: f76, k77: f77, k78: f78, k79: f79};
show("holder", () => Object.keys(holder).map((k) => holder[k]([1])).join());`,
      [80, n => `class C${n} { constructor(v) { this.v${n} = v; this.tag = ${n}; } m(p) { return p.x + this.tag; } }`],
      `const instances = [new C0(0), new C1(1), new C2(2), new C3(3), new C4(4), new C5(5), new C6(6), new C7(7), new C8(8), new C9(9), new C10(10), new C11(11), new C12(12), new C13(13), new C14(14), new C15(15), new C16(16), new C17(17), new C18(18), new C19(19), new C20(20), new C21(21), new C22(22), new C23(23), new C24(24), new C25(25), new C26(26), new C27(27), new C28(28), new C29(29), new C30(30), new C31(31), new C32(32), new C33(33), new C34(34), new C35(35), new C36(36), new C37(37), new C38(38), new C39(39), new C40(40), new C41(41), new C42(42), new C43(43), new C44(44), new C45(45), new C46(46), new C47(47), new C48(48), new C49(49), new C50(50), new C51(51), new C52(52), new C53(53), new C54(54), new C55(55), new C56(56), new C57(57), new C58(58), new C59(59), new C60(60), new C61(61), new C62(62), new C63(63), new C64(64), new C65(65), new C66(66), new C67(67), new C68(68), new C69(69), new C70(70), new C71(71), new C72(72), new C73(73), new C74(74), new C75(75), new C76(76), new C77(77), new C78(78), new C79(79)];
let typed = 0;`,
      [80, n => `typed += new C${n}(0).m(O);`],
      `console.log("typed", typed);
show("methods-str", () => instances.map((o) => o.m("s")).join());
show("methods-borrowed", () => instances.map((o, i) => o.m.call(instances[(i + 1) % instances.length], true)).join());
show("ctor-by-value", () => instances.map((o) => Object.keys(new o.constructor("cv")).join("")).join());
function many(p) { return typeof p + Object.keys(p).length; }
const literals = [{ a0_0: 0 }, { a1_0: 0, a1_1: 1 }, { a2_0: 0, a2_1: 1, a2_2: 2 }, { a3_0: 0 }, { a4_0: 0, a4_1: 1 }, { a5_0: 0, a5_1: 1, a5_2: 2 }, { a6_0: 0 }, { a7_0: 0, a7_1: 1 }, { a8_0: 0, a8_1: 1, a8_2: 2 }, { a9_0: 0 }, { a10_0: 0, a10_1: 1 }, { a11_0: 0, a11_1: 1, a11_2: 2 }, { a12_0: 0 }, { a13_0: 0, a13_1: 1 }, { a14_0: 0, a14_1: 1, a14_2: 2 }, { a15_0: 0 }, { a16_0: 0, a16_1: 1 }, { a17_0: 0, a17_1: 1, a17_2: 2 }, { a18_0: 0 }, { a19_0: 0, a19_1: 1 }, { a20_0: 0, a20_1: 1, a20_2: 2 }, { a21_0: 0 }, { a22_0: 0, a22_1: 1 }, { a23_0: 0, a23_1: 1, a23_2: 2 }, { a24_0: 0 }, { a25_0: 0, a25_1: 1 }, { a26_0: 0, a26_1: 1, a26_2: 2 }, { a27_0: 0 }, { a28_0: 0, a28_1: 1 }, { a29_0: 0, a29_1: 1, a29_2: 2 }, { a30_0: 0 }, { a31_0: 0, a31_1: 1 }, { a32_0: 0, a32_1: 1, a32_2: 2 }, { a33_0: 0 }, { a34_0: 0, a34_1: 1 }, { a35_0: 0, a35_1: 1, a35_2: 2 }, { a36_0: 0 }, { a37_0: 0, a37_1: 1 }, { a38_0: 0, a38_1: 1, a38_2: 2 }, { a39_0: 0 }, { a40_0: 0, a40_1: 1 }, { a41_0: 0, a41_1: 1, a41_2: 2 }, { a42_0: 0 }, { a43_0: 0, a43_1: 1 }, { a44_0: 0, a44_1: 1, a44_2: 2 }, { a45_0: 0 }, { a46_0: 0, a46_1: 1 }, { a47_0: 0, a47_1: 1, a47_2: 2 }, { a48_0: 0 }, { a49_0: 0, a49_1: 1 }, { a50_0: 0, a50_1: 1, a50_2: 2 }, { a51_0: 0 }, { a52_0: 0, a52_1: 1 }, { a53_0: 0, a53_1: 1, a53_2: 2 }, { a54_0: 0 }, { a55_0: 0, a55_1: 1 }, { a56_0: 0, a56_1: 1, a56_2: 2 }, { a57_0: 0 }, { a58_0: 0, a58_1: 1 }, { a59_0: 0, a59_1: 1, a59_2: 2 }, { a60_0: 0 }, { a61_0: 0, a61_1: 1 }, { a62_0: 0, a62_1: 1, a62_2: 2 }, { a63_0: 0 }, { a64_0: 0, a64_1: 1 }, { a65_0: 0, a65_1: 1, a65_2: 2 }, { a66_0: 0 }, { a67_0: 0, a67_1: 1 }, { a68_0: 0, a68_1: 1, a68_2: 2 }, { a69_0: 0 }, { a70_0: 0, a70_1: 1 }, { a71_0: 0, a71_1: 1, a71_2: 2 }, { a72_0: 0 }, { a73_0: 0, a73_1: 1 }, { a74_0: 0, a74_1: 1, a74_2: 2 }, { a75_0: 0 }, { a76_0: 0, a76_1: 1 }, { a77_0: 0, a77_1: 1, a77_2: 2 }, { a78_0: 0 }, { a79_0: 0, a79_1: 1 }];
show("literals", () => literals.map(many).join());
show("literals-odd", () => [1, "two", [3], () => 4].map(many).join());
`,
    ),
    "objects-inside-objects/ways-made-by-ways.js": text(
      `// Objects inside objects: ways made by ways. It prints what plain Bun prints.
const kept = [];
const turns = Number(process.env.WAYS_TURNS || 1);
const only = process.env.WAYS_ONLY;
function way(label, f) { if (only && only !== label) return; for (let turn = 0; turn < turns; turn++) kept.push(f(turn)); }
function nothing() {}
let out = null;
function letOut(o) { out = o; }
function byStores(t) {
  const o = {};`,
      [40, n => `  o.st${n} = t;`],
      `  return o;
}
function byStoresWithCalls(t) {
  const o = {};`,
      [40, n => `  o.sc${n} = t; nothing();`],
      `  return o;
}
function byLiteral(t) {
  return { li0: t, li1: t, li2: t, li3: t, li4: t, li5: t, li6: t, li7: t, li8: t, li9: t, li10: t, li11: t, li12: t, li13: t, li14: t, li15: t, li16: t, li17: t, li18: t, li19: t, li20: t, li21: t, li22: t, li23: t, li24: t, li25: t, li26: t, li27: t, li28: t, li29: t, li30: t, li31: t, li32: t, li33: t, li34: t, li35: t, li36: t, li37: t, li38: t, li39: t };
}
const keysK = ["ke0","ke1","ke2","ke3","ke4","ke5","ke6","ke7","ke8","ke9","ke10","ke11","ke12","ke13","ke14","ke15","ke16","ke17","ke18","ke19","ke20","ke21","ke22","ke23","ke24","ke25","ke26","ke27","ke28","ke29","ke30","ke31","ke32","ke33","ke34","ke35","ke36","ke37","ke38","ke39"];
function byKeys(t) {
  const o = {};
  for (const k of keysK) o[k] = t;
  return o;
}
const halfA = { sa0: 1, sa1: 1, sa2: 1, sa3: 1, sa4: 1, sa5: 1, sa6: 1, sa7: 1, sa8: 1, sa9: 1, sa10: 1, sa11: 1, sa12: 1, sa13: 1, sa14: 1, sa15: 1, sa16: 1, sa17: 1, sa18: 1, sa19: 1 }, halfB = { sb0: 1, sb1: 1, sb2: 1, sb3: 1, sb4: 1, sb5: 1, sb6: 1, sb7: 1, sb8: 1, sb9: 1, sb10: 1, sb11: 1, sb12: 1, sb13: 1, sb14: 1, sb15: 1, sb16: 1, sb17: 1, sb18: 1, sb19: 1 };
function bySpreads(t) {
  return { ...halfA, ...halfB };
}
const halfC = { aa0: 1, aa1: 1, aa2: 1, aa3: 1, aa4: 1, aa5: 1, aa6: 1, aa7: 1, aa8: 1, aa9: 1, aa10: 1, aa11: 1, aa12: 1, aa13: 1, aa14: 1, aa15: 1, aa16: 1, aa17: 1, aa18: 1, aa19: 1 }, halfD = { ab0: 1, ab1: 1, ab2: 1, ab3: 1, ab4: 1, ab5: 1, ab6: 1, ab7: 1, ab8: 1, ab9: 1, ab10: 1, ab11: 1, ab12: 1, ab13: 1, ab14: 1, ab15: 1, ab16: 1, ab17: 1, ab18: 1, ab19: 1 };
function byAssign(t) {
  return Object.assign({}, halfC, halfD);
}
const text = '{"js0":1,"js1":1,"js2":1,"js3":1,"js4":1,"js5":1,"js6":1,"js7":1,"js8":1,"js9":1,"js10":1,"js11":1,"js12":1,"js13":1,"js14":1,"js15":1,"js16":1,"js17":1,"js18":1,"js19":1,"js20":1,"js21":1,"js22":1,"js23":1,"js24":1,"js25":1,"js26":1,"js27":1,"js28":1,"js29":1,"js30":1,"js31":1,"js32":1,"js33":1,"js34":1,"js35":1,"js36":1,"js37":1,"js38":1,"js39":1}';
function byParse(t) {
  return JSON.parse(text);
}
const keysD = ["de0","de1","de2","de3","de4","de5","de6","de7","de8","de9","de10","de11","de12","de13","de14","de15","de16","de17","de18","de19","de20","de21","de22","de23","de24","de25","de26","de27","de28","de29","de30","de31","de32","de33","de34","de35","de36","de37","de38","de39"];
function byDefine(t) {
  const o = {};
  for (const k of keysD) Object.defineProperty(o, k, { value: t, enumerable: true, writable: true, configurable: true });
  return o;
}
function byGetters(t) {
  const o = {};
  for (const k of keysD) Object.defineProperty(o, "g" + k, { get: nothing, enumerable: true, configurable: true });
  return o;
}
const pairs = [["fe0",1],["fe1",1],["fe2",1],["fe3",1],["fe4",1],["fe5",1],["fe6",1],["fe7",1],["fe8",1],["fe9",1],["fe10",1],["fe11",1],["fe12",1],["fe13",1],["fe14",1],["fe15",1],["fe16",1],["fe17",1],["fe18",1],["fe19",1],["fe20",1],["fe21",1],["fe22",1],["fe23",1],["fe24",1],["fe25",1],["fe26",1],["fe27",1],["fe28",1],["fe29",1],["fe30",1],["fe31",1],["fe32",1],["fe33",1],["fe34",1],["fe35",1],["fe36",1],["fe37",1],["fe38",1],["fe39",1]];
function byFromEntries(t) {
  return Object.fromEntries(pairs);
}
class Fields { cf0 = 1; cf1 = 1; cf2 = 1; cf3 = 1; cf4 = 1; cf5 = 1; cf6 = 1; cf7 = 1; cf8 = 1; cf9 = 1; cf10 = 1; cf11 = 1; cf12 = 1; cf13 = 1; cf14 = 1; cf15 = 1; cf16 = 1; cf17 = 1; cf18 = 1; cf19 = 1; cf20 = 1; cf21 = 1; cf22 = 1; cf23 = 1; cf24 = 1; cf25 = 1; cf26 = 1; cf27 = 1; cf28 = 1; cf29 = 1; cf30 = 1; cf31 = 1; cf32 = 1; cf33 = 1; cf34 = 1; cf35 = 1; cf36 = 1; cf37 = 1; cf38 = 1; cf39 = 1; }
function byClassFields(t) {
  return new Fields();
}
function Ctor(t) {`,
      [40, n => `  this.ct${n} = t; nothing();`],
      `}
function byConstructor(t) {
  return new Ctor(t);
}
function byComputedLiteral(t) {
  return { [keysK[0] + "c"]: t, [keysK[1] + "c"]: t, [keysK[2] + "c"]: t, [keysK[3] + "c"]: t, [keysK[4] + "c"]: t, [keysK[5] + "c"]: t, [keysK[6] + "c"]: t, [keysK[7] + "c"]: t, [keysK[8] + "c"]: t, [keysK[9] + "c"]: t, [keysK[10] + "c"]: t, [keysK[11] + "c"]: t, [keysK[12] + "c"]: t, [keysK[13] + "c"]: t, [keysK[14] + "c"]: t, [keysK[15] + "c"]: t, [keysK[16] + "c"]: t, [keysK[17] + "c"]: t, [keysK[18] + "c"]: t, [keysK[19] + "c"]: t, [keysK[20] + "c"]: t, [keysK[21] + "c"]: t, [keysK[22] + "c"]: t, [keysK[23] + "c"]: t, [keysK[24] + "c"]: t, [keysK[25] + "c"]: t, [keysK[26] + "c"]: t, [keysK[27] + "c"]: t, [keysK[28] + "c"]: t, [keysK[29] + "c"]: t, [keysK[30] + "c"]: t, [keysK[31] + "c"]: t, [keysK[32] + "c"]: t, [keysK[33] + "c"]: t, [keysK[34] + "c"]: t, [keysK[35] + "c"]: t, [keysK[36] + "c"]: t, [keysK[37] + "c"]: t, [keysK[38] + "c"]: t, [keysK[39] + "c"]: t };
}
function byStoresAfterItGotOut(t) {
  const o = {};
  letOut(o);`,
      [40, n => `  o.go${n} = t;`],
      `  return o;
}
function fill(o, t) {`,
      [40, n => `  o.pa${n} = t;`],
      `}
function byCallee(t) {
  const o = {};
  fill(o, t);
  return o;
}
class Later { constructor() { this.first = 1; }`,
      [40, n => `  m${n}(t) { this.la${n} = t; }`],
      `}
function byMethodsLater(t) {
  const o = new Later();`,
      [40, n => `  o.m${n}(t);`],
      `  return o;
}
function byOrAssign(t) {
  const o = {};
  letOut(o);`,
      [40, n => `  o.oa${n} ??= t;`],
      `  return o;
}
function byStatics(t) {
  class S {}`,
      [40, n => `  S.ss${n} = t;`],
      `  return S;
}
function byFunctionProperties(t) {
  function f() {}`,
      [40, n => `  f.fp${n} = t;`],
      `  return f;
}
function byPrototype(t) {
  function P() {}`,
      [40, n => `  P.prototype.pr${n} = nothing;`],
      `  return P;
}
function commonJS(cb) { let mod; return () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); }
function byExports(t) {
  return commonJS((exports, module) => {`,
      [40, n => `    exports.ex${n} = t;`],
      `  })();
}
function byEmptyClassAgain(t) {
  class D extends Object {}
  Object.defineProperty(D, "name", { value: "n" + t });
  return D;
}
function byClassAgain(t) {
  return class C { m0() { return t; } m1() { return t; } m2() { return t; } m3() { return t; } m4() { return t; } m5() { return t; } m6() { return t; } m7() { return t; } m8() { return t; } m9() { return t; } get g() { return t; } static s0() { return t; } static s1() { return t; } };
}
const withGetter = { wg0: 1, wg1: 1, wg2: 1, wg3: 1, wg4: 1, wg5: 1, wg6: 1, wg7: 1, wg8: 1, wg9: 1, wg10: 1, wg11: 1, wg12: 1, wg13: 1, wg14: 1, wg15: 1, wg16: 1, wg17: 1, wg18: 1, wg19: 1, wg20: 1, wg21: 1, wg22: 1, wg23: 1, wg24: 1, wg25: 1, wg26: 1, wg27: 1, wg28: 1, wg29: 1, wg30: 1, wg31: 1, wg32: 1, wg33: 1, wg34: 1, wg35: 1, wg36: 1, wg37: 1, wg38: 1, get wgLast() { return 1; } };
function bySpreadOfGetter(t) {
  return { ...withGetter };
}
function byRestOfGetter(t) {
  const { wg0, ...rest } = withGetter;
  return rest;
}
function byLiteral63(t) {
  return { L63_0: t, L63_1: t, L63_2: t, L63_3: t, L63_4: t, L63_5: t, L63_6: t, L63_7: t, L63_8: t, L63_9: t, L63_10: t, L63_11: t, L63_12: t, L63_13: t, L63_14: t, L63_15: t, L63_16: t, L63_17: t, L63_18: t, L63_19: t, L63_20: t, L63_21: t, L63_22: t, L63_23: t, L63_24: t, L63_25: t, L63_26: t, L63_27: t, L63_28: t, L63_29: t, L63_30: t, L63_31: t, L63_32: t, L63_33: t, L63_34: t, L63_35: t, L63_36: t, L63_37: t, L63_38: t, L63_39: t, L63_40: t, L63_41: t, L63_42: t, L63_43: t, L63_44: t, L63_45: t, L63_46: t, L63_47: t, L63_48: t, L63_49: t, L63_50: t, L63_51: t, L63_52: t, L63_53: t, L63_54: t, L63_55: t, L63_56: t, L63_57: t, L63_58: t, L63_59: t, L63_60: t, L63_61: t, L63_62: t };
}
function byLiteral70(t) {
  return { L70_0: t, L70_1: t, L70_2: t, L70_3: t, L70_4: t, L70_5: t, L70_6: t, L70_7: t, L70_8: t, L70_9: t, L70_10: t, L70_11: t, L70_12: t, L70_13: t, L70_14: t, L70_15: t, L70_16: t, L70_17: t, L70_18: t, L70_19: t, L70_20: t, L70_21: t, L70_22: t, L70_23: t, L70_24: t, L70_25: t, L70_26: t, L70_27: t, L70_28: t, L70_29: t, L70_30: t, L70_31: t, L70_32: t, L70_33: t, L70_34: t, L70_35: t, L70_36: t, L70_37: t, L70_38: t, L70_39: t, L70_40: t, L70_41: t, L70_42: t, L70_43: t, L70_44: t, L70_45: t, L70_46: t, L70_47: t, L70_48: t, L70_49: t, L70_50: t, L70_51: t, L70_52: t, L70_53: t, L70_54: t, L70_55: t, L70_56: t, L70_57: t, L70_58: t, L70_59: t, L70_60: t, L70_61: t, L70_62: t, L70_63: t, L70_64: t, L70_65: t, L70_66: t, L70_67: t, L70_68: t, L70_69: t };
}
function byLiteral110(t) {
  return { L110_0: t, L110_1: t, L110_2: t, L110_3: t, L110_4: t, L110_5: t, L110_6: t, L110_7: t, L110_8: t, L110_9: t, L110_10: t, L110_11: t, L110_12: t, L110_13: t, L110_14: t, L110_15: t, L110_16: t, L110_17: t, L110_18: t, L110_19: t, L110_20: t, L110_21: t, L110_22: t, L110_23: t, L110_24: t, L110_25: t, L110_26: t, L110_27: t, L110_28: t, L110_29: t, L110_30: t, L110_31: t, L110_32: t, L110_33: t, L110_34: t, L110_35: t, L110_36: t, L110_37: t, L110_38: t, L110_39: t, L110_40: t, L110_41: t, L110_42: t, L110_43: t, L110_44: t, L110_45: t, L110_46: t, L110_47: t, L110_48: t, L110_49: t, L110_50: t, L110_51: t, L110_52: t, L110_53: t, L110_54: t, L110_55: t, L110_56: t, L110_57: t, L110_58: t, L110_59: t, L110_60: t, L110_61: t, L110_62: t, L110_63: t, L110_64: t, L110_65: t, L110_66: t, L110_67: t, L110_68: t, L110_69: t, L110_70: t, L110_71: t, L110_72: t, L110_73: t, L110_74: t, L110_75: t, L110_76: t, L110_77: t, L110_78: t, L110_79: t, L110_80: t, L110_81: t, L110_82: t, L110_83: t, L110_84: t, L110_85: t, L110_86: t, L110_87: t, L110_88: t, L110_89: t, L110_90: t, L110_91: t, L110_92: t, L110_93: t, L110_94: t, L110_95: t, L110_96: t, L110_97: t, L110_98: t, L110_99: t, L110_100: t, L110_101: t, L110_102: t, L110_103: t, L110_104: t, L110_105: t, L110_106: t, L110_107: t, L110_108: t, L110_109: t };
}
function byLiteral300(t) {
  return { L300_0: t, L300_1: t, L300_2: t, L300_3: t, L300_4: t, L300_5: t, L300_6: t, L300_7: t, L300_8: t, L300_9: t, L300_10: t, L300_11: t, L300_12: t, L300_13: t, L300_14: t, L300_15: t, L300_16: t, L300_17: t, L300_18: t, L300_19: t, L300_20: t, L300_21: t, L300_22: t, L300_23: t, L300_24: t, L300_25: t, L300_26: t, L300_27: t, L300_28: t, L300_29: t, L300_30: t, L300_31: t, L300_32: t, L300_33: t, L300_34: t, L300_35: t, L300_36: t, L300_37: t, L300_38: t, L300_39: t, L300_40: t, L300_41: t, L300_42: t, L300_43: t, L300_44: t, L300_45: t, L300_46: t, L300_47: t, L300_48: t, L300_49: t, L300_50: t, L300_51: t, L300_52: t, L300_53: t, L300_54: t, L300_55: t, L300_56: t, L300_57: t, L300_58: t, L300_59: t, L300_60: t, L300_61: t, L300_62: t, L300_63: t, L300_64: t, L300_65: t, L300_66: t, L300_67: t, L300_68: t, L300_69: t, L300_70: t, L300_71: t, L300_72: t, L300_73: t, L300_74: t, L300_75: t, L300_76: t, L300_77: t, L300_78: t, L300_79: t, L300_80: t, L300_81: t, L300_82: t, L300_83: t, L300_84: t, L300_85: t, L300_86: t, L300_87: t, L300_88: t, L300_89: t, L300_90: t, L300_91: t, L300_92: t, L300_93: t, L300_94: t, L300_95: t, L300_96: t, L300_97: t, L300_98: t, L300_99: t, L300_100: t, L300_101: t, L300_102: t, L300_103: t, L300_104: t, L300_105: t, L300_106: t, L300_107: t, L300_108: t, L300_109: t, L300_110: t, L300_111: t, L300_112: t, L300_113: t, L300_114: t, L300_115: t, L300_116: t, L300_117: t, L300_118: t, L300_119: t, L300_120: t, L300_121: t, L300_122: t, L300_123: t, L300_124: t, L300_125: t, L300_126: t, L300_127: t, L300_128: t, L300_129: t, L300_130: t, L300_131: t, L300_132: t, L300_133: t, L300_134: t, L300_135: t, L300_136: t, L300_137: t, L300_138: t, L300_139: t, L300_140: t, L300_141: t, L300_142: t, L300_143: t, L300_144: t, L300_145: t, L300_146: t, L300_147: t, L300_148: t, L300_149: t, L300_150: t, L300_151: t, L300_152: t, L300_153: t, L300_154: t, L300_155: t, L300_156: t, L300_157: t, L300_158: t, L300_159: t, L300_160: t, L300_161: t, L300_162: t, L300_163: t, L300_164: t, L300_165: t, L300_166: t, L300_167: t, L300_168: t, L300_169: t, L300_170: t, L300_171: t, L300_172: t, L300_173: t, L300_174: t, L300_175: t, L300_176: t, L300_177: t, L300_178: t, L300_179: t, L300_180: t, L300_181: t, L300_182: t, L300_183: t, L300_184: t, L300_185: t, L300_186: t, L300_187: t, L300_188: t, L300_189: t, L300_190: t, L300_191: t, L300_192: t, L300_193: t, L300_194: t, L300_195: t, L300_196: t, L300_197: t, L300_198: t, L300_199: t, L300_200: t, L300_201: t, L300_202: t, L300_203: t, L300_204: t, L300_205: t, L300_206: t, L300_207: t, L300_208: t, L300_209: t, L300_210: t, L300_211: t, L300_212: t, L300_213: t, L300_214: t, L300_215: t, L300_216: t, L300_217: t, L300_218: t, L300_219: t, L300_220: t, L300_221: t, L300_222: t, L300_223: t, L300_224: t, L300_225: t, L300_226: t, L300_227: t, L300_228: t, L300_229: t, L300_230: t, L300_231: t, L300_232: t, L300_233: t, L300_234: t, L300_235: t, L300_236: t, L300_237: t, L300_238: t, L300_239: t, L300_240: t, L300_241: t, L300_242: t, L300_243: t, L300_244: t, L300_245: t, L300_246: t, L300_247: t, L300_248: t, L300_249: t, L300_250: t, L300_251: t, L300_252: t, L300_253: t, L300_254: t, L300_255: t, L300_256: t, L300_257: t, L300_258: t, L300_259: t, L300_260: t, L300_261: t, L300_262: t, L300_263: t, L300_264: t, L300_265: t, L300_266: t, L300_267: t, L300_268: t, L300_269: t, L300_270: t, L300_271: t, L300_272: t, L300_273: t, L300_274: t, L300_275: t, L300_276: t, L300_277: t, L300_278: t, L300_279: t, L300_280: t, L300_281: t, L300_282: t, L300_283: t, L300_284: t, L300_285: t, L300_286: t, L300_287: t, L300_288: t, L300_289: t, L300_290: t, L300_291: t, L300_292: t, L300_293: t, L300_294: t, L300_295: t, L300_296: t, L300_297: t, L300_298: t, L300_299: t };
}
function control(t) {
  return null;
}
way("byStores", byStores);
way("byStoresWithCalls", byStoresWithCalls);
way("byLiteral", byLiteral);
way("byKeys", byKeys);
way("bySpreads", bySpreads);
way("byAssign", byAssign);
way("byParse", byParse);
way("byDefine", byDefine);
way("byGetters", byGetters);
way("byFromEntries", byFromEntries);
way("byClassFields", byClassFields);
way("byConstructor", byConstructor);
way("byComputedLiteral", byComputedLiteral);
way("byStoresAfterItGotOut", byStoresAfterItGotOut);
way("byCallee", byCallee);
way("byMethodsLater", byMethodsLater);
way("byOrAssign", byOrAssign);
way("byStatics", byStatics);
way("byFunctionProperties", byFunctionProperties);
way("byPrototype", byPrototype);
way("byExports", byExports);
way("byEmptyClassAgain", byEmptyClassAgain);
way("byClassAgain", byClassAgain);
way("bySpreadOfGetter", bySpreadOfGetter);
way("byRestOfGetter", byRestOfGetter);
way("byLiteral63", byLiteral63);
way("byLiteral70", byLiteral70);
way("byLiteral110", byLiteral110);
way("byLiteral300", byLiteral300);
way("control", control);
console.log(kept.length);
`,
    ),
  });
