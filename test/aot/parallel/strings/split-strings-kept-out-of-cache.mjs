// A program that splits more strings of its image than the cache of splits holds: they stay out of the cache while few are found in it. A few strings split again and again are found.
// COUNTER: ImageStringsKeptOutOfSplitCache >= 500
const out = [];
const words = [
  "efia@1-9@.x00.com", "cg@ze1.com", "c@2.com", "addcce@@00@@3.com", "af@@xu@4.com", "fch@yx@00x-5.com",
  "dbdh@2.u@z6.com", "f@@zz3@y07.com", "@u@08.com", "a@9.com", "hfdcjc@0y@e@-10.com", "hhfh@0@-911.com",
  "fcbhei@@uyu2@3@12.com", "cj@13.com", "ief@uu0-14.com", "hffici@u@15.com", "ebg@0216.com", "adcjh@1-y@@@-yu17.com",
  "jbj@u0@18.com", "gbifai@3@u@u-9@19.com", "j@x20.com", "bfj@019@-23021.com", "@@3xey22.com", "cgahii@91@323.com",
  "hj@.@xu@224.com", "hbid@25.com", "gjj@@@0@zx026.com", "ehec@9@27.com", "cgji@28.com", "@zx029.com",
  "@y..@@e30.com", "c@-0.z.@z9u31.com", "@@332.com", "ijde@233.com", "eicdfh@xzy.ee34.com", "fbi@35.com",
  "gacg@z@036.com", "j@1u0u0@37.com", "ia@@-.-y9u9038.com", "hh@-39.com", "@@@2-140.com", "@@uye@141.com",
  "cadaj@0@342.com", "h@e10@043.com", "eahah@yu@1@944.com", "@9y045.com", "eaa@0146.com", "bbicjb@e9047.com",
  "caeh@@z248.com", "gfccib@z19y3@@49.com", "@0x@@ex50.com", "agebg@z@zxy@@51.com", "eja@@-52.com", "jcbe@@0.e@0y-53.com",
  "hhja@054.com", "adaaj@u0055.com", "ii@11@y056.com", "cc@y0357.com", "f@z@x-@x058.com", "high@@y0x0zu0x59.com",
  "db@60.com", "befjji@z@061.com", "agg@0@62.com", "fgfb@u.3z@01063.com", "dgh@12x3-64.com", "bahci@e65.com",
  "gdjhb@66.com", "c@@67.com", "jb@@@.ze@@68.com", "bdgihg@69.com", "@@x@39@0@70.com", "ceh@371.com",
  "fbi@0@z.0@72.com", "gdbh@z@xe@73.com", "ibaddh@74.com", "ibe@@x00@@y0075.com", "ggacfc@0@u076.com", "e@3.77.com",
  "chbbga@@x9@@z78.com", "ja@79.com", "g@u80.com", "dc@z.u981.com", "jhdj@x@82.com", "h@83.com",
  "@84.com", "dgdijd@10@385.com", "hbb@20@-z86.com", "hadij@3@0ux087.com", "haab@@88.com", "fe@@2x089.com",
  "d@e@@y90.com", "fibah@91.com", "jhaaj@e1.zez92.com", "ebgee@x@9@20@93.com", "bg@0@@e@x294.com", "hiid@-2@.02z@95.com",
  "@.96.com", "ejcaig@297.com", "@03y98.com", "@e13@@.199.com", "@z02e@0@@-100.com", "f@3e220.0.101.com",
  "dcd@ee102.com", "chbeje@.x99@103.com", "jejf@104.com", "ci@u@0y-0105.com", "egjhf@x99ux.-@106.com", "idgbgg@x1u107.com",
  "jed@e108.com", "aeiacg@109.com", "add@e110.com", "hheiba@0e@z0u@00111.com", "@0.@0112.com", "g@x021@0@113.com",
  "ihddf@y-.0@-@.e114.com", "fbhcfa@115.com", "jfhej@@00x3z9116.com", "b@z0u@3.@@z117.com", "@932z@3@118.com", "ebge@u0@..119.com",
  "hfahaj@@e@120.com", "ifii@@121.com", "hgdj@@zyu.e122.com", "e@123.com", "bjab@3124.com", "gd@125.com",
  "hec@0@y9@126.com", "jbbhef@@@e@e127.com", "ec@@0128.com", "ed@e001x@3-129.com", "aadhae@y@@e..130.com", "ebdbb@@@2209@9@131.com",
  "aidgjb@2@z@132.com", "fd@xu0@3x0x133.com", "ebdd@0@-134.com", "@9e2-.ux-3135.com", "ehj@@0x@x-2u.136.com", "dajd@@20@137.com",
  "hia@y2--@1138.com", "jjae@9-e139.com", "hhj@@1@140.com", "@e141.com", "acah@@@@@0-@0142.com", "ifdc@y231z143.com",
  "hhdf@u@3u3144.com", "@.2.31-0.145.com", "ig@@146.com", "@e@30x147.com", "heh@z148.com", "g@1149.com",
  "ijgid@ux0e1@@150.com", "dd@z3@e@y@151.com", "f@0e@152.com", "hjchc@eeu@@153.com", "dbief@yu-@154.com", "igf@0@-xy0@9.155.com",
  "dfd@y@03-156.com", "a@zu@@9-0157.com", "ejj@158.com", "jdbgci@159.com", "jfeaa@0.1-0-9160.com", "jg@2y@91zz161.com",
  "bjgj@@162.com", "h@u20.z@163.com", "jdagb@ze164.com", "beabj@109199@0165.com", "ecaga@ue91u0166.com", "@167.com",
  "adih@0@168.com", "eg@z169.com", "@0@@uu030170.com", "jgdjfc@x0x29zyz171.com", "ajfbb@@@1x0y0172.com", "fed@@00@0173.com",
  "@92@x0@0@174.com", "bfed@u093175.com", "cb@@@ue@@9176.com", "dhcice@00@u177.com", "@@.@e0@3@178.com", "hdge@179.com",
  "@u222z180.com", "b@z2181.com", "jegbg@ezu1182.com", "degc@02z-z03183.com", "a@09@e3.u184.com", "fici@1@-9185.com",
  "hdcgi@186.com", "ccfjda@@0xe187.com", "cb@@z0euz2188.com", "bcbbb@e99e189.com", "fd@@2z0z90190.com", "dcf@1@z@0191.com",
  "ecie@uy03@192.com", "@@@@10193.com", "ddjehc@0@3y2@@@194.com", "dah@@0@3@195.com", "bac@x02uy@.0u196.com", "adcjb@3@@197.com",
  "ah@@@198.com", "dj@-9@199.com", "d@@31@0y@3e200.com", "@9yz0201.com", "h@@1@202.com", "haf@-u203.com",
  "jgcgd@x1z@@0@00204.com", "hcchjf@205.com", "eeeig@uzu@@y1x206.com", "@@207.com", "@@.xu208.com", "cgfjf@1@@0@209.com",
  "dihe@0@3@0210.com", "edgdha@9e02211.com", "igie@@@9ye212.com", "gbjed@@213.com", "dff@01214.com", "ja@0@yx9u@215.com",
  "dbihci@9y@216.com", "jhid@.yz.1217.com", "djecd@0@0218.com", "bgija@0329z219.com",
];
const few = ["alpha,beta,gamma", "one,two,three,four", "a,,b,", ",", ""];
let sum = 0;
const at = (word) => word.split("@");
const point = (word) => word.split(".");
const comma = (word) => word.split(",");
for (let round = 0; round < 12; round++) {
  for (const word of words) {
    const parts = at(word);
    const more = point(word);
    sum = (sum * 31 + parts.length + more.length + parts[0].length * 7 + (more[1] === "com")) | 0;
    if (round === 11) out.push(parts.join("|"), more.join("|"));
    if (parts.length > 2) parts.push("pushed");
    parts[0] = "changed";
  }
  for (const word of few) {
    for (let i = 0; i < 20; i++) {
      const parts = comma(word);
      sum = (sum * 31 + parts.length + parts.indexOf("beta")) | 0;
      if (i === 7) parts.sort();
      if (i === 9) parts.length = 1;
    }
    out.push(comma(word).join("|"), word.split("").length, word.split(",", 2).join("|"), word.split("zz").join("|"));
  }
  if (round % 5 === 4) Bun.gc(true);
}
// Strings allocated at run time, pieces and the same texts as literals.
for (const word of words.slice(0, 40)) {
  const copy = JSON.parse(JSON.stringify(word)), piece = ("xx" + copy + "yy").slice(2, 2 + word.length);
  out.push(at(copy).join("|"), at(piece).join("|"), at(word).join("|") === at(copy).join("|"), Object.isFrozen(at(word)));
}
console.log(out.length, sum, Bun.hash(out.join("~")).toString(36));
console.log(out.slice(0, 30).join(" "));
