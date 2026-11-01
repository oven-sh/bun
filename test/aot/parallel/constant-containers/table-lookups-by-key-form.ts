// Lookups in Map and Set tables of every size and storage, typed, untyped and through the prototype, with each form a string key can take. Every answer is compared with a linear search of the inserted keys.
const CONSTANT_KEYS_3: string[] = ["c3k0", "c3k1", "c3k2"];
const CONSTANT_MAP_3 = new Map<string, number>([["c3k0", 1], ["c3k1", 4], ["c3k2", 7]]);
const CONSTANT_SET_3 = new Set<string>(["c3k0", "c3k1", "c3k2"]);
const CONSTANT_KEYS_20: string[] = ["c20k0", "c20k1", "c20k2", "c20k3", "c20k4", "c20k5", "c20k6", "c20k7", "c20k8", "c20k9", "c20k10", "c20k11", "c20k12", "c20k13", "c20k14", "c20k15", "c20k16", "c20k17", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"];
const CONSTANT_MAP_20 = new Map<string, number>([["c20k0", 1], ["c20k1", 4], ["c20k2", 7], ["c20k3", 10], ["c20k4", 13], ["c20k5", 16], ["c20k6", 19], ["c20k7", 22], ["c20k8", 25], ["c20k9", 28], ["c20k10", 31], ["c20k11", 34], ["c20k12", 37], ["c20k13", 40], ["c20k14", 43], ["c20k15", 46], ["c20k16", 49], ["c20k17", 52], ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 55], ["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", 58]]);
const CONSTANT_SET_20 = new Set<string>(["c20k0", "c20k1", "c20k2", "c20k3", "c20k4", "c20k5", "c20k6", "c20k7", "c20k8", "c20k9", "c20k10", "c20k11", "c20k12", "c20k13", "c20k14", "c20k15", "c20k16", "c20k17", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]);
const CONSTANT_KEYS_300: string[] = ["c300k0", "c300k1", "c300k2", "c300k3", "c300k4", "c300k5", "c300k6", "c300k7", "c300k8", "c300k9", "c300k10", "c300k11", "c300k12", "c300k13", "c300k14", "c300k15", "c300k16", "c300k17", "c300k18", "c300k19", "c300k20", "c300k21", "c300k22", "c300k23", "c300k24", "c300k25", "c300k26", "c300k27", "c300k28", "c300k29", "c300k30", "c300k31", "c300k32", "c300k33", "c300k34", "c300k35", "c300k36", "c300k37", "c300k38", "c300k39", "c300k40", "c300k41", "c300k42", "c300k43", "c300k44", "c300k45", "c300k46", "c300k47", "c300k48", "c300k49", "c300k50", "c300k51", "c300k52", "c300k53", "c300k54", "c300k55", "c300k56", "c300k57", "c300k58", "c300k59", "c300k60", "c300k61", "c300k62", "c300k63", "c300k64", "c300k65", "c300k66", "c300k67", "c300k68", "c300k69", "c300k70", "c300k71", "c300k72", "c300k73", "c300k74", "c300k75", "c300k76", "c300k77", "c300k78", "c300k79", "c300k80", "c300k81", "c300k82", "c300k83", "c300k84", "c300k85", "c300k86", "c300k87", "c300k88", "c300k89", "c300k90", "c300k91", "c300k92", "c300k93", "c300k94", "c300k95", "c300k96", "c300k97", "c300k98", "c300k99", "c300k100", "c300k101", "c300k102", "c300k103", "c300k104", "c300k105", "c300k106", "c300k107", "c300k108", "c300k109", "c300k110", "c300k111", "c300k112", "c300k113", "c300k114", "c300k115", "c300k116", "c300k117", "c300k118", "c300k119", "c300k120", "c300k121", "c300k122", "c300k123", "c300k124", "c300k125", "c300k126", "c300k127", "c300k128", "c300k129", "c300k130", "c300k131", "c300k132", "c300k133", "c300k134", "c300k135", "c300k136", "c300k137", "c300k138", "c300k139", "c300k140", "c300k141", "c300k142", "c300k143", "c300k144", "c300k145", "c300k146", "c300k147", "c300k148", "c300k149", "c300k150", "c300k151", "c300k152", "c300k153", "c300k154", "c300k155", "c300k156", "c300k157", "c300k158", "c300k159", "c300k160", "c300k161", "c300k162", "c300k163", "c300k164", "c300k165", "c300k166", "c300k167", "c300k168", "c300k169", "c300k170", "c300k171", "c300k172", "c300k173", "c300k174", "c300k175", "c300k176", "c300k177", "c300k178", "c300k179", "c300k180", "c300k181", "c300k182", "c300k183", "c300k184", "c300k185", "c300k186", "c300k187", "c300k188", "c300k189", "c300k190", "c300k191", "c300k192", "c300k193", "c300k194", "c300k195", "c300k196", "c300k197", "c300k198", "c300k199", "c300k200", "c300k201", "c300k202", "c300k203", "c300k204", "c300k205", "c300k206", "c300k207", "c300k208", "c300k209", "c300k210", "c300k211", "c300k212", "c300k213", "c300k214", "c300k215", "c300k216", "c300k217", "c300k218", "c300k219", "c300k220", "c300k221", "c300k222", "c300k223", "c300k224", "c300k225", "c300k226", "c300k227", "c300k228", "c300k229", "c300k230", "c300k231", "c300k232", "c300k233", "c300k234", "c300k235", "c300k236", "c300k237", "c300k238", "c300k239", "c300k240", "c300k241", "c300k242", "c300k243", "c300k244", "c300k245", "c300k246", "c300k247", "c300k248", "c300k249", "c300k250", "c300k251", "c300k252", "c300k253", "c300k254", "c300k255", "c300k256", "c300k257", "c300k258", "c300k259", "c300k260", "c300k261", "c300k262", "c300k263", "c300k264", "c300k265", "c300k266", "c300k267", "c300k268", "c300k269", "c300k270", "c300k271", "c300k272", "c300k273", "c300k274", "c300k275", "c300k276", "c300k277", "c300k278", "c300k279", "c300k280", "c300k281", "c300k282", "c300k283", "c300k284", "c300k285", "c300k286", "c300k287", "c300k288", "c300k289", "c300k290", "c300k291", "c300k292", "c300k293", "c300k294", "c300k295", "c300k296", "c300k297", "c300k298", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"];
const CONSTANT_MAP_300 = new Map<string, number>([["c300k0", 1], ["c300k1", 4], ["c300k2", 7], ["c300k3", 10], ["c300k4", 13], ["c300k5", 16], ["c300k6", 19], ["c300k7", 22], ["c300k8", 25], ["c300k9", 28], ["c300k10", 31], ["c300k11", 34], ["c300k12", 37], ["c300k13", 40], ["c300k14", 43], ["c300k15", 46], ["c300k16", 49], ["c300k17", 52], ["c300k18", 55], ["c300k19", 58], ["c300k20", 61], ["c300k21", 64], ["c300k22", 67], ["c300k23", 70], ["c300k24", 73], ["c300k25", 76], ["c300k26", 79], ["c300k27", 82], ["c300k28", 85], ["c300k29", 88], ["c300k30", 91], ["c300k31", 94], ["c300k32", 97], ["c300k33", 100], ["c300k34", 103], ["c300k35", 106], ["c300k36", 109], ["c300k37", 112], ["c300k38", 115], ["c300k39", 118], ["c300k40", 121], ["c300k41", 124], ["c300k42", 127], ["c300k43", 130], ["c300k44", 133], ["c300k45", 136], ["c300k46", 139], ["c300k47", 142], ["c300k48", 145], ["c300k49", 148], ["c300k50", 151], ["c300k51", 154], ["c300k52", 157], ["c300k53", 160], ["c300k54", 163], ["c300k55", 166], ["c300k56", 169], ["c300k57", 172], ["c300k58", 175], ["c300k59", 178], ["c300k60", 181], ["c300k61", 184], ["c300k62", 187], ["c300k63", 190], ["c300k64", 193], ["c300k65", 196], ["c300k66", 199], ["c300k67", 202], ["c300k68", 205], ["c300k69", 208], ["c300k70", 211], ["c300k71", 214], ["c300k72", 217], ["c300k73", 220], ["c300k74", 223], ["c300k75", 226], ["c300k76", 229], ["c300k77", 232], ["c300k78", 235], ["c300k79", 238], ["c300k80", 241], ["c300k81", 244], ["c300k82", 247], ["c300k83", 250], ["c300k84", 253], ["c300k85", 256], ["c300k86", 259], ["c300k87", 262], ["c300k88", 265], ["c300k89", 268], ["c300k90", 271], ["c300k91", 274], ["c300k92", 277], ["c300k93", 280], ["c300k94", 283], ["c300k95", 286], ["c300k96", 289], ["c300k97", 292], ["c300k98", 295], ["c300k99", 298], ["c300k100", 301], ["c300k101", 304], ["c300k102", 307], ["c300k103", 310], ["c300k104", 313], ["c300k105", 316], ["c300k106", 319], ["c300k107", 322], ["c300k108", 325], ["c300k109", 328], ["c300k110", 331], ["c300k111", 334], ["c300k112", 337], ["c300k113", 340], ["c300k114", 343], ["c300k115", 346], ["c300k116", 349], ["c300k117", 352], ["c300k118", 355], ["c300k119", 358], ["c300k120", 361], ["c300k121", 364], ["c300k122", 367], ["c300k123", 370], ["c300k124", 373], ["c300k125", 376], ["c300k126", 379], ["c300k127", 382], ["c300k128", 385], ["c300k129", 388], ["c300k130", 391], ["c300k131", 394], ["c300k132", 397], ["c300k133", 400], ["c300k134", 403], ["c300k135", 406], ["c300k136", 409], ["c300k137", 412], ["c300k138", 415], ["c300k139", 418], ["c300k140", 421], ["c300k141", 424], ["c300k142", 427], ["c300k143", 430], ["c300k144", 433], ["c300k145", 436], ["c300k146", 439], ["c300k147", 442], ["c300k148", 445], ["c300k149", 448], ["c300k150", 451], ["c300k151", 454], ["c300k152", 457], ["c300k153", 460], ["c300k154", 463], ["c300k155", 466], ["c300k156", 469], ["c300k157", 472], ["c300k158", 475], ["c300k159", 478], ["c300k160", 481], ["c300k161", 484], ["c300k162", 487], ["c300k163", 490], ["c300k164", 493], ["c300k165", 496], ["c300k166", 499], ["c300k167", 502], ["c300k168", 505], ["c300k169", 508], ["c300k170", 511], ["c300k171", 514], ["c300k172", 517], ["c300k173", 520], ["c300k174", 523], ["c300k175", 526], ["c300k176", 529], ["c300k177", 532], ["c300k178", 535], ["c300k179", 538], ["c300k180", 541], ["c300k181", 544], ["c300k182", 547], ["c300k183", 550], ["c300k184", 553], ["c300k185", 556], ["c300k186", 559], ["c300k187", 562], ["c300k188", 565], ["c300k189", 568], ["c300k190", 571], ["c300k191", 574], ["c300k192", 577], ["c300k193", 580], ["c300k194", 583], ["c300k195", 586], ["c300k196", 589], ["c300k197", 592], ["c300k198", 595], ["c300k199", 598], ["c300k200", 601], ["c300k201", 604], ["c300k202", 607], ["c300k203", 610], ["c300k204", 613], ["c300k205", 616], ["c300k206", 619], ["c300k207", 622], ["c300k208", 625], ["c300k209", 628], ["c300k210", 631], ["c300k211", 634], ["c300k212", 637], ["c300k213", 640], ["c300k214", 643], ["c300k215", 646], ["c300k216", 649], ["c300k217", 652], ["c300k218", 655], ["c300k219", 658], ["c300k220", 661], ["c300k221", 664], ["c300k222", 667], ["c300k223", 670], ["c300k224", 673], ["c300k225", 676], ["c300k226", 679], ["c300k227", 682], ["c300k228", 685], ["c300k229", 688], ["c300k230", 691], ["c300k231", 694], ["c300k232", 697], ["c300k233", 700], ["c300k234", 703], ["c300k235", 706], ["c300k236", 709], ["c300k237", 712], ["c300k238", 715], ["c300k239", 718], ["c300k240", 721], ["c300k241", 724], ["c300k242", 727], ["c300k243", 730], ["c300k244", 733], ["c300k245", 736], ["c300k246", 739], ["c300k247", 742], ["c300k248", 745], ["c300k249", 748], ["c300k250", 751], ["c300k251", 754], ["c300k252", 757], ["c300k253", 760], ["c300k254", 763], ["c300k255", 766], ["c300k256", 769], ["c300k257", 772], ["c300k258", 775], ["c300k259", 778], ["c300k260", 781], ["c300k261", 784], ["c300k262", 787], ["c300k263", 790], ["c300k264", 793], ["c300k265", 796], ["c300k266", 799], ["c300k267", 802], ["c300k268", 805], ["c300k269", 808], ["c300k270", 811], ["c300k271", 814], ["c300k272", 817], ["c300k273", 820], ["c300k274", 823], ["c300k275", 826], ["c300k276", 829], ["c300k277", 832], ["c300k278", 835], ["c300k279", 838], ["c300k280", 841], ["c300k281", 844], ["c300k282", 847], ["c300k283", 850], ["c300k284", 853], ["c300k285", 856], ["c300k286", 859], ["c300k287", 862], ["c300k288", 865], ["c300k289", 868], ["c300k290", 871], ["c300k291", 874], ["c300k292", 877], ["c300k293", 880], ["c300k294", 883], ["c300k295", 886], ["c300k296", 889], ["c300k297", 892], ["c300k298", 895], ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 898]]);
const CONSTANT_SET_300 = new Set<string>(["c300k0", "c300k1", "c300k2", "c300k3", "c300k4", "c300k5", "c300k6", "c300k7", "c300k8", "c300k9", "c300k10", "c300k11", "c300k12", "c300k13", "c300k14", "c300k15", "c300k16", "c300k17", "c300k18", "c300k19", "c300k20", "c300k21", "c300k22", "c300k23", "c300k24", "c300k25", "c300k26", "c300k27", "c300k28", "c300k29", "c300k30", "c300k31", "c300k32", "c300k33", "c300k34", "c300k35", "c300k36", "c300k37", "c300k38", "c300k39", "c300k40", "c300k41", "c300k42", "c300k43", "c300k44", "c300k45", "c300k46", "c300k47", "c300k48", "c300k49", "c300k50", "c300k51", "c300k52", "c300k53", "c300k54", "c300k55", "c300k56", "c300k57", "c300k58", "c300k59", "c300k60", "c300k61", "c300k62", "c300k63", "c300k64", "c300k65", "c300k66", "c300k67", "c300k68", "c300k69", "c300k70", "c300k71", "c300k72", "c300k73", "c300k74", "c300k75", "c300k76", "c300k77", "c300k78", "c300k79", "c300k80", "c300k81", "c300k82", "c300k83", "c300k84", "c300k85", "c300k86", "c300k87", "c300k88", "c300k89", "c300k90", "c300k91", "c300k92", "c300k93", "c300k94", "c300k95", "c300k96", "c300k97", "c300k98", "c300k99", "c300k100", "c300k101", "c300k102", "c300k103", "c300k104", "c300k105", "c300k106", "c300k107", "c300k108", "c300k109", "c300k110", "c300k111", "c300k112", "c300k113", "c300k114", "c300k115", "c300k116", "c300k117", "c300k118", "c300k119", "c300k120", "c300k121", "c300k122", "c300k123", "c300k124", "c300k125", "c300k126", "c300k127", "c300k128", "c300k129", "c300k130", "c300k131", "c300k132", "c300k133", "c300k134", "c300k135", "c300k136", "c300k137", "c300k138", "c300k139", "c300k140", "c300k141", "c300k142", "c300k143", "c300k144", "c300k145", "c300k146", "c300k147", "c300k148", "c300k149", "c300k150", "c300k151", "c300k152", "c300k153", "c300k154", "c300k155", "c300k156", "c300k157", "c300k158", "c300k159", "c300k160", "c300k161", "c300k162", "c300k163", "c300k164", "c300k165", "c300k166", "c300k167", "c300k168", "c300k169", "c300k170", "c300k171", "c300k172", "c300k173", "c300k174", "c300k175", "c300k176", "c300k177", "c300k178", "c300k179", "c300k180", "c300k181", "c300k182", "c300k183", "c300k184", "c300k185", "c300k186", "c300k187", "c300k188", "c300k189", "c300k190", "c300k191", "c300k192", "c300k193", "c300k194", "c300k195", "c300k196", "c300k197", "c300k198", "c300k199", "c300k200", "c300k201", "c300k202", "c300k203", "c300k204", "c300k205", "c300k206", "c300k207", "c300k208", "c300k209", "c300k210", "c300k211", "c300k212", "c300k213", "c300k214", "c300k215", "c300k216", "c300k217", "c300k218", "c300k219", "c300k220", "c300k221", "c300k222", "c300k223", "c300k224", "c300k225", "c300k226", "c300k227", "c300k228", "c300k229", "c300k230", "c300k231", "c300k232", "c300k233", "c300k234", "c300k235", "c300k236", "c300k237", "c300k238", "c300k239", "c300k240", "c300k241", "c300k242", "c300k243", "c300k244", "c300k245", "c300k246", "c300k247", "c300k248", "c300k249", "c300k250", "c300k251", "c300k252", "c300k253", "c300k254", "c300k255", "c300k256", "c300k257", "c300k258", "c300k259", "c300k260", "c300k261", "c300k262", "c300k263", "c300k264", "c300k265", "c300k266", "c300k267", "c300k268", "c300k269", "c300k270", "c300k271", "c300k272", "c300k273", "c300k274", "c300k275", "c300k276", "c300k277", "c300k278", "c300k279", "c300k280", "c300k281", "c300k282", "c300k283", "c300k284", "c300k285", "c300k286", "c300k287", "c300k288", "c300k289", "c300k290", "c300k291", "c300k292", "c300k293", "c300k294", "c300k295", "c300k296", "c300k297", "c300k298", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);

interface Table {
    name: string;
    map: Map<string, number>;
    set: Set<string>;
    keys: string[];
    values: number[];
}

const RUN_TIME_SIZES = [0, 1, 8, 9, 254, 255, 5000];
const LARGE_TABLE_SAMPLE_STRIDE = 7;
const HASHING_RECEIVER = { unrelated: 1 };
const LITERAL_PROBES = ["key0", "key1", "key7", "key8", "key253", "key254", "key4999", "c3k1", "c20k5", "c300k299"];
const WIDE_PREFIX = "ሴ";

let checkCount = 0;
let failureCount = 0;
let valueSum = 0;

function sameValueZero(left: unknown, right: unknown): boolean {
    return left === right || (left !== left && right !== right);
}

function findLinear(keys: readonly unknown[], key: unknown): number {
    for (let i = 0; i < keys.length; i++) {
        if (sameValueZero(keys[i], key))
            return i;
    }
    return -1;
}

function builtFromParts(text: string): string {
    const half = text.length >> 1;
    return text.slice(0, half) + text.slice(half);
}

function flattenedNeverHashed(text: string): string {
    const built = builtFromParts(text);
    built.charCodeAt(0);
    return built;
}

function hashedAsPropertyName(text: string): string {
    const built = flattenedNeverHashed(text);
    if (built in HASHING_RECEIVER)
        valueSum++;
    return built;
}

function substringOfLonger(text: string): string {
    return ("<<" + text + ">>").slice(2, 2 + text.length);
}

function sixteenBit(text: string): string {
    return (WIDE_PREFIX + text).slice(1);
}

const KEY_FORMS: ((text: string) => string)[] = [builtFromParts, flattenedNeverHashed, hashedAsPropertyName, substringOfLonger, sixteenBit];

function getTyped(map: Map<string, number>, key: string): number | undefined {
    return map.get(key);
}

function hasInMapTyped(map: Map<string, number>, key: string): boolean {
    return map.has(key);
}

function hasInSetTyped(set: Set<string>, key: string): boolean {
    return set.has(key);
}

function getUntyped(map: any, key: any): any {
    return map.get(key);
}

function hasUntyped(table: any, key: any): any {
    return table.has(key);
}

function getThroughPrototype(map: any, key: any): any {
    return Map.prototype.get.call(map, key);
}

function hasInMapThroughPrototype(map: any, key: any): any {
    return Map.prototype.has.call(map, key);
}

function hasInSetThroughPrototype(set: any, key: any): any {
    return Set.prototype.has.call(set, key);
}

function expectAnswer(table: Table, way: string, key: unknown, actual: unknown, expected: unknown): void {
    checkCount++;
    if (sameValueZero(actual, expected))
        return;
    failureCount++;
    if (failureCount <= 20)
        console.log("wrong answer", table.name, way, typeof key, String(key).slice(0, 40), actual, expected);
}

interface Lookup {
    name: string;
    returnsValue: boolean;
    find: (table: Table, key: any) => unknown;
}

const TYPED_LOOKUPS: Lookup[] = [
    { name: "get typed", returnsValue: true, find: (table, key) => getTyped(table.map, key) },
    { name: "has typed in map", returnsValue: false, find: (table, key) => hasInMapTyped(table.map, key) },
    { name: "has typed in set", returnsValue: false, find: (table, key) => hasInSetTyped(table.set, key) },
];

const UNTYPED_LOOKUPS: Lookup[] = [
    { name: "get untyped", returnsValue: true, find: (table, key) => getUntyped(table.map, key) },
    { name: "get through prototype", returnsValue: true, find: (table, key) => getThroughPrototype(table.map, key) },
    { name: "has untyped in map", returnsValue: false, find: (table, key) => hasUntyped(table.map, key) },
    { name: "has untyped in set", returnsValue: false, find: (table, key) => hasUntyped(table.set, key) },
    { name: "has in map through prototype", returnsValue: false, find: (table, key) => hasInMapThroughPrototype(table.map, key) },
    { name: "has in set through prototype", returnsValue: false, find: (table, key) => hasInSetThroughPrototype(table.set, key) },
];

// A lookup may flatten and hash its key in place, so each lookup gets a key of its own.
function checkLookups(table: Table, lookups: Lookup[], createKey: () => unknown, position: number): void {
    const value = position < 0 ? undefined : table.values[position];
    for (const lookup of lookups) {
        const key = createKey();
        expectAnswer(table, lookup.name, key, lookup.find(table, key), lookup.returnsValue ? value : position >= 0);
    }
}

function checkUntypedKey(table: Table, createKey: () => unknown, position: number): void {
    checkLookups(table, UNTYPED_LOOKUPS, createKey, position);
    if (position >= 0)
        valueSum += table.values[position];
}

function checkStringKey(table: Table, createKey: () => string, position: number): void {
    checkLookups(table, TYPED_LOOKUPS, createKey, position);
    checkUntypedKey(table, createKey, position);
}

function checkEveryForm(table: Table, text: string, position: number): void {
    for (const form of KEY_FORMS)
        checkStringKey(table, () => form(text), position);
}

function checkInsertedKeys(table: Table): void {
    const stride = table.keys.length > 1000 ? LARGE_TABLE_SAMPLE_STRIDE : 1;
    const cells = [...table.set];
    for (let i = 0; i < cells.length; i += stride) {
        const cell = cells[i];
        const position = findLinear(table.keys, cell);
        checkStringKey(table, () => cell, position);
        checkEveryForm(table, cell, position);
    }
    for (const literal of LITERAL_PROBES)
        checkStringKey(table, () => literal, findLinear(table.keys, literal));
}

function checkAbsentStrings(table: Table): void {
    for (let i = 0; i < 3000; i++) {
        const text = hashedAsPropertyName("absent" + i);
        checkStringKey(table, () => text, findLinear(table.keys, text));
    }
    const stride = Math.max(1, table.keys.length >> 7);
    for (let i = 0; i < table.keys.length; i += stride) {
        const key = table.keys[i];
        const sameLength = key.slice(0, -1) + "~";
        checkEveryForm(table, sameLength, findLinear(table.keys, sameLength));
        const longer = key + "~";
        checkEveryForm(table, longer, findLinear(table.keys, longer));
    }
    const others = ["", "~", "a".repeat(255), "a".repeat(256), "b".repeat(256), "b".repeat(255), "c".repeat(300), "c".repeat(44), "d".repeat(256), "d".repeat(512), WIDE_PREFIX, WIDE_PREFIX + "key1"];
    for (const text of others) {
        const position = findLinear(table.keys, text);
        checkStringKey(table, () => text, position);
        checkEveryForm(table, text, position);
    }
}

function checkOtherValues(table: Table): void {
    const values: unknown[] = [undefined, null, true, false, 1, -0, 0, NaN, 1.5, 2 ** 31, -1, 1n, 2n ** 70n, {}, [], Symbol("key1"), Symbol.iterator, () => 1];
    for (const value of values)
        checkUntypedKey(table, () => value, -1);
    expectAnswer(table, "get typed undefined", undefined, getTyped(table.map, undefined as unknown as string), undefined);
    expectAnswer(table, "has typed null", null, hasInSetTyped(table.set, null as unknown as string), false);
    checkUntypedKey(table, () => "1", findLinear(table.keys, "1"));
}

function checkTable(table: Table, phase: string): void {
    const checksBefore = checkCount;
    const failuresBefore = failureCount;
    checkInsertedKeys(table);
    checkAbsentStrings(table);
    checkOtherValues(table);
    console.log(table.name, phase, "size", table.map.size, table.set.size, "checks", checkCount - checksBefore, "failures", failureCount - failuresBefore);
}

function deleteEveryThirdKey(table: Table): void {
    const keys: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < table.keys.length; i++) {
        if (i % 3) {
            keys.push(table.keys[i]);
            values.push(table.values[i]);
            continue;
        }
        table.map.delete(table.keys[i]);
        table.set.delete(table.keys[i]);
    }
    table.keys = keys;
    table.values = values;
}

function createRunTimeTable(size: number): Table {
    const map = new Map<string, number>();
    const set = new Set<string>();
    const keys: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < size; i++) {
        const key = "key" + i;
        map.set(key, 3 * i + 1);
        set.add(key);
        keys.push(key);
        values.push(3 * i + 1);
    }
    return { name: "run-time-" + size, map, set, keys, values };
}

function createConstantTable(map: Map<string, number>, set: Set<string>, keys: string[]): Table {
    return { name: "constant-" + keys.length, map, set, keys: keys.slice(), values: keys.map((_, i) => 3 * i + 1) };
}

function checkMixedKeys(): void {
    const sharedObject = {};
    const sharedSymbol = Symbol("shared");
    const inserted: unknown[] = ["1", 1, 0, NaN, 1.5, 2 ** 31, 1n, undefined, null, true, sharedObject, sharedSymbol, "", "text"];
    const map = new Map<unknown, number>();
    const set = new Set<unknown>();
    inserted.forEach((key, i) => {
        map.set(key, i);
        set.add(key);
    });
    const table = { name: "mixed", map, set, keys: inserted, values: inserted.map((_, i) => i) } as unknown as Table;
    const probes: unknown[] = [...inserted, -0, 2, 2.5, 2n, 10n ** 30n, false, {}, Symbol("shared"), "2", BigInt(1), 1.5 + 0, 2 ** 30 * 2];
    for (const probe of probes)
        checkUntypedKey(table, () => probe, findLinear(inserted, probe));
    for (const text of ["text", "1", "", "2", "texts"]) {
        for (const form of KEY_FORMS)
            checkUntypedKey(table, () => form(text), findLinear(inserted, text));
    }
    console.log("mixed", "size", map.size, set.size);
}

const tables: Table[] = RUN_TIME_SIZES.map(createRunTimeTable);
tables.push(createConstantTable(CONSTANT_MAP_3, CONSTANT_SET_3, CONSTANT_KEYS_3));
tables.push(createConstantTable(CONSTANT_MAP_20, CONSTANT_SET_20, CONSTANT_KEYS_20));
tables.push(createConstantTable(CONSTANT_MAP_300, CONSTANT_SET_300, CONSTANT_KEYS_300));

for (const table of tables) {
    checkTable(table, "full");
    deleteEveryThirdKey(table);
    checkTable(table, "after deletes");
}
checkMixedKeys();
console.log("total", checkCount, "failures", failureCount, "value sum", valueSum);
