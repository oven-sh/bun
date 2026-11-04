// A Set or a Map that the program writes out of texts alone lies in the image. `has` of a text that the program wrote too is answered by the cell of the entry's own constant; every other text by its characters.
// Whatever way a text was made, and whether or not anybody has asked for the constant before, the answer is that of the characters.
const small = new Set(["tubrilo", "wem", "hul", "ty", "lomi", "zomidormi"]);
const medium = new Set([
  "lojorrendor", "jor", "lodorlowem", "nexzo", "wemren", "wemsaren", "hulren", "cu", "quawem", "gafenjorfen", "nexdorsa", "mijor", "tyquaga", "nexcumiren", "sagatuqua", "lomiwemjor", "gahulcu", "jorfenmimi", "quamilo", "jorfennex",
  "hulkafenhul", "curen", "lovelnextu", "bribri", "misafenbri", "tuzowem", "zohulbri", "tumi", "tudor", "kaqua", "pinex", "tu", "wemhulcujor", "tutycu", "fen", "bribribriren", "brilovelmi", "fensa", "ga", "ren",
  "cukami", "cubri", "pihul", "quarenren", "fenquaquanex", "quasaty", "vel", "tuwemka", "mipity", "sahuldor", "dorcuvel", "bridor", "tyqua", "kakapi", "pivelcuhul", "hulhulmidor", "dor", "velgavelqua", "qua", "mirenbri"]);
const large = new Set([
  "quasa", "gamibrifen", "misasatu", "tucucuqua", "tuwemwem", "kaka", "zovel", "kapi", "nexty", "jorga", "wemzotu", "jortyzoty", "wemtu", "cuka", "satu", "curenwemlo", "tytywem", "renwemlodor", "pilo", "wemkamifen",
  "cutycu", "pifen", "tydortypi", "fentu", "renbrifenga", "mivelnexren", "hultu", "tufendor", "bri", "sadorsazo", "gazovelhul", "mihulka", "wemfenfen", "tycunex", "renmi", "pilosa", "tuzopi", "tuwemtyjor", "gamipilo", "zomi",
  "kamipi", "mipi", "picutulo", "rensa", "losavel", "nextyvel", "fentysa", "hulkapi", "ka", "fenren", "quawembrity", "veldorga", "tubri", "lotuka", "pi", "salomibri", "cudornex", "sapi", "kapihulga", "dorlonex",
  "hulsa", "miquapity", "dorty", "mi", "mitubri", "nex", "dormijor", "quatunex", "loty", "tytutyty", "mika", "renbrifen", "quapi", "mipidor", "dorfen", "brimiquanex", "micu", "gapi", "cujortu", "renvelqua",
  "tynexfen", "fenrenwemvel", "miquaka", "fenmity", "pibrivelvel", "hultucu", "renhuldor", "quabrikasa", "brinextuzo", "brigaren", "kagaga", "renvelkanex", "hulmibri", "jormihulzo", "lopiren", "dorpi", "tygavelhul", "kabriwemwem", "milo", "fencutunex",
  "lowemtusa", "zoganexnex", "pibridor", "quawembri", "sa", "mivel", "wemdorfenga", "zotuwemvel", "misa", "wemmiga", "hulpi", "kazo", "zotyvelbri", "galoqua", "jorhultu", "zonexkatu", "zo", "jorquakami", "tyfenfendor", "tuty",
  "dorjor", "pity", "renrenminex", "bripi", "fenpiga", "quaty", "wemdor", "lokavel", "zomipidor", "huldorqualo", "kanex", "velnexveldor", "dorpinexren", "cusadorqua", "locutubri", "zolo", "fengarenmi", "gavel", "tyfen", "hulgafensa",
  "renwemvelbri", "nexzomi", "hulwem", "velgahulqua", "brilo", "lofenmilo", "velmicu", "hulpiga", "pinexka", "renqua", "bripizoqua", "cudor", "gafenhul", "brisa", "sazoren", "fensadortu", "fencudorwem", "pijorpi", "pipivel", "dorsadordor",
  "nexjor", "gami", "pidortyty", "renfen", "fenhul", "renlo", "cujor", "mihul", "fencu", "karencu", "vellohul", "tulovel", "locuvel", "hulsacunex", "mizorenbri", "wemmi", "nexnexzolo", "jorhulzo", "kahulvelbri", "velkazosa",
  "renmibrijor", "fensatu", "lo", "brimi", "tysatu", "nexsaty", "miren", "quavelnextu", "locubri", "dorcu", "cuvelquasa", "lobri", "brihul", "vello", "wemnexzonex", "zobri", "fentyfen", "fendorfencu", "saquabriren", "zohulmi",
  "tytylolo", "miga", "tukamicu", "quanex", "dormi", "cupisa", "cupifen", "veljorpicu", "gahul", "gabrisa", "rentylo", "fenwemty", "hulpibrihul", "hulga", "sacu", "nexjorga", "tunex", "zotyhullo", "quador", "nexrenty",
  "wemdorzo", "jortuvel", "cuquasa", "kador", "bripika", "cujorfen", "dorsakalo", "dorsa", "tuzo", "tycu", "cusatynex", "fenmifensa", "renpi", "loren", "pilopi", "typinexvel", "dorvelsa", "velbriga", "briwem", "quatykaka",
  "dorjornexvel", "cujormijor", "tulo", "velwemmi", "rendorvelvel", "quarentu", "gagazo", "kahulpi", "lohulga", "nexcukazo", "lowemjorvel", "sazoka", "nexlo", "renquasaqua", "typijor", "nexvel", "wemrengahul", "mizokahul", "nexpi", "wemtysabri",
  "tytufen", "safenfen", "jordortu", "fendorty", "cutyhul", "dorga", "piren", "renvel", "tutunexnex", "pivelrenren", "velbrifen", "zodortynex", "katupicu", "kadorzojor", "dorjordorsa", "gapirenzo", "zoquafen", "tysagaka", "quarenlopi", "savel",
  "renjorfen", "zofenvel", "brity", "lopipi", "brilokami", "zohuljorpi", "britydor", "fenvelsatu", "wemdortuhul", "fennexwemtu", "huldorpibri", "zosaqua", "dornexga", "quazocumi", "tunexbri", "tutyhul", "minex", "curenjor", "hultuvelbri", "cucu",
  "velquavel", "dortuquaqua", "tuquadorqua", "wemcu", "fenjorqua", "fenhulzo", "misahulka", "quatulovel", "tugarenhul", "quatywem", "zopiwem", "hulquabri", "typity", "velquaren", "velganex", "jormi", "wemjorlobri", "renkalo", "quacu", "cutucumi",
  "lofen", "tunexwem", "nexsazo", "jorbrifenmi", "quazo", "veltukazo", "rentu", "kapijordor", "salohultu", "fenpilolo", "nexcusa", "culogahul", "quasaturen", "sazoqua", "fenpijorga", "pilocu", "cukatu", "jorzodor", "bribricudor", "nexkagapi",
  "zosajor", "jortu", "wemquahul", "briveldornex", "velpijorka", "fenwemmiwem", "midorbri", "tygaqua", "velvel", "huljorjor", "britytu", "loqua", "renhulfen", "cukahul", "tycuka", "jorqua", "pipi", "renfenjorcu", "velsabri", "fenquami",
  "renmipiga", "mity", "safensahul", "lowemka", "lorentuga", "jorjorfen", "hulpibri", "brisafendor", "kafen", "losa", "tufenren", "kamifenga", "dorquaren", "tugador", "wemtufentu", "zozodor", "gasapi", "rengafenqua", "nexrenpivel", "zopidor",
  "renbri", "zosalo", "tukafen", "sahulzo", "pijor", "tusa", "pisaveltu", "jornex", "kami", "lotyhulga", "quamika", "quatupidor", "jorhul", "jorcuka", "tyfenty", "dorgabri", "tykatywem", "saren", "piwemka", "pika"]);
const prices = new Map([["tubrilo", 0], ["wem", 3], ["hul", 6], ["ty", 9], ["lomi", 12], ["zomidormi", 15]]);
// Written, and in none of them. Among so many, some share the mark of an entry in the index.
const others = [
  "tydorfenren", "rensalo", "renfenqua", "renrenren", "tuwemjordor", "tujor", "brisakabri", "cucutylo", "lohulgabri", "gazo", "briwemlo", "tytuhul", "zoka", "rentysa", "veltykador", "lololocu", "cupiwem", "lonex", "sarenlo", "mifenjor",
  "pidormi", "fencujor", "brivel", "fenwemnex", "quanexkador", "dorvelty", "jorbrikahul", "quapinex", "fenloty", "fenhulrenty", "hultuvel", "tyrenqua", "tuzoren", "jortuzopi", "fennexhulnex", "britywem", "gakaquabri", "nexsawemnex", "zojor", "jordormiga",
  "cudorga", "jorquanex", "wemcuzo", "brifenhullo", "fenkami", "renzo", "tybriwem", "velzo", "brifencujor", "tymisa", "gahulmi", "tysaren", "gatyzo", "tynex", "tyvel", "salojorcu", "wemkanex", "renjorkaka", "saqua", "wemtytu",
  "zocu", "tyty", "cuzoloka", "tudorhul", "salopi", "kalodorbri", "dordor", "gaka", "nexzocupi", "midorbrijor", "zonex", "quakadormi", "sahul", "sakanexbri", "rengawem", "gabrimiren", "hulwemdorbri", "fennex", "dorzolo", "kagatu",
  "piwem", "wemfen", "dorsahulhul", "nexqua", "picu", "jorhulwemdor", "cutyveltu", "brikajor", "nexka", "misadorga", "tynexvel", "tubrinex", "brifentu", "sakahul", "zokafen", "renpicu", "sajordor", "typizojor", "karennex", "velhulmi",
  "bricudorpi", "fengatyfen", "tytuquavel", "sawemsa", "wempi", "hulzomi", "nextu", "quaqua", "dorka", "tuhulnextu", "jorjor", "garen", "satucufen", "velrennexka", "quavello", "velrennex", "rensagafen", "jorhulnexsa", "migajorpi", "quavelwemga",
  "dormitu", "tunexhulsa", "rennex", "brisahul", "dorhultu", "pidorlo", "lovelquazo", "sanexcujor", "brimilofen", "velvelhulka", "tunexmilo", "gamifenka", "sabri", "kafenjor", "jorvelqua", "tyfenzo", "bricu", "cunexjor", "hulquatunex", "tykavel",
  "fenmi", "hultydorjor", "bripirendor", "velwem", "renvelty", "quadorwem", "dorwemjorren", "tywem", "wemsaveljor", "mituhulcu", "lohul", "micuveljor", "tytyhul", "locuhulren", "wemgacu", "fenka", "renkaquaren", "tuwem", "britujor", "wempifen",
  "tuquaty", "lolomisa", "quasafenbri", "cuty", "tyvelnex", "jorcu", "hulfen", "jorfenbri", "gakaga", "gadorkador", "culotutu", "bripimi", "lowem", "jorrenhulnex", "gahulty", "galogaga", "tyhuldordor", "tutuvel", "fenbrijornex", "nexnex",
  "jorwemga", "sapipi", "dorkavel", "velcunexty", "lotu", "tukavel", "wemkaga", "gakaqua", "cugasalo", "lomicuga", "cubripifen", "jorgalo", "cugasami", "zohulwem", "dorcupi", "lonexwemfen", "hultyty", "tupika", "renhultudor", "mikacutu",
  "wemsa", "cuhultu", "saty", "fenqua", "hulbri", "velgakaren", "hullodorjor", "zobridorka", "kapizo", "dorhul", "nexquavel", "saga", "veljorlovel", "lofensa", "tunexkaren", "katu", "brimizoga", "galojordor", "kalo", "jorzo",
  "tyzo", "quamihul", "sakapi", "milovel", "pikaga", "wemgazo", "brizoga", "britubribri", "tukadorcu", "cubridor", "wemgafenwem", "fenjorka", "quatygajor", "dorbrihulmi", "typicuga", "cupi", "quahulty", "jordortumi", "tyvelty", "huldor",
  "tufen", "loga", "hulzorenzo", "pibri", "tytynex", "mipibrinex", "renfenquasa", "quatydor", "tygabri", "kawemvel", "lojorsa", "wempiga", "dorpifen", "miveltuzo", "cuhullo", "brihullonex", "zocupihul", "brijor", "cuvel", "mivelga",
  "bribrityzo", "karenjorjor", "fenzozoqua", "mifen", "quatutyka", "velbri", "brifenren", "miveljorfen", "qualowem", "jortuzolo", "gaga", "tyka", "migabri", "nexwembri", "lonexnexdor", "zowempinex", "wemhul", "quajortuhul", "velfenwem", "lopidor",
  "nexvelveljor", "brifenvelvel", "renlotumi", "sakawemsa", "dornexvelwem", "tuvel", "dorpifenzo", "nexdorjorga", "wemveltu", "britunex", "zoga", "renlohulren", "hulkaquami", "cujorwem", "veltunex", "hulfenqua", "renwemrensa", "fenlololo", "mihulsa", "samiga",
  "tupiren", "piwemwemren", "fendorsa", "hulvelnex", "wemveltudor", "renka", "jorveldormi", "tupi", "cutyrennex", "renlovel", "nexga", "kaga", "zolomidor", "tysa", "veldor", "mikaqua", "micumi", "mihuljorsa", "quatupinex", "jorwemren",
  "dorvel", "wemdorquajor", "gabribrimi", "gacu", "nexkanexqua", "zozocunex", "tugawemvel", "fenculonex", "mipisa", "zowemdorren", "tuhulsa", "hulcu", "nexquagaty", "rendor", "jorpihulren", "tupizomi", "fenpinex", "nexbrity", "hulkaloren", "fennextytu",
  "logaquatu", "veljor", "jorpi", "nexwem", "mibriquahul", "gasajor", "lowemhultu", "tylo", "brihulsa", "fenbriren", "hulbriga", "quapirenvel", "tyzosaga", "wemquawem", "mipibrihul", "tynexrenpi", "kalowemjor", "hulcuhul", "dormiwem", "rennexsasa",
  "gabribriqua", "hulsatu", "nextuvelga", "veljorpitu", "tubricu", "micucu", "cuveldor", "renhuljor", "velkafen", "fenpi", "renquadornex", "gatyjor", "katy", "mijorren", "brityjorzo", "pimiqua", "zofen", "velgacuvel", "velpi", "wemnex",
  "velzoka", "wemhulsa", "hulnexren", "quaquami", "gaquatu", "tybrivel", "pikavel", "tyzobri", "zotu", "karen", "jorwem", "kakamifen", "cuwemfen", "velkadorvel", "brirenren", "velfen", "jorjorfenmi", "quacuturen", "cubrimidor", "kabri",
  "lodor", "lobridordor", "pilotufen", "rentybri", "fenbrika", "kasa", "velrenvelzo", "renmidor", "pinexnex", "tuquacu", "velkami", "tybri", "zocujorvel", "cunex", "pitupinex", "kagabri", "saquacuga", "dorkazo", "kadorga", "zogahul"];
const writtenSmall = ["tubrilo", "wem", "hul", "ty", "lomi", "zomidormi"];
const writtenMedium = [
  "lojorrendor", "jor", "lodorlowem", "nexzo", "wemren", "wemsaren", "hulren", "cu", "quawem", "gafenjorfen", "nexdorsa", "mijor", "tyquaga", "nexcumiren", "sagatuqua", "lomiwemjor", "gahulcu", "jorfenmimi", "quamilo", "jorfennex",
  "hulkafenhul", "curen", "lovelnextu", "bribri", "misafenbri", "tuzowem", "zohulbri", "tumi", "tudor", "kaqua", "pinex", "tu", "wemhulcujor", "tutycu", "fen", "bribribriren", "brilovelmi", "fensa", "ga", "ren",
  "cukami", "cubri", "pihul", "quarenren", "fenquaquanex", "quasaty", "vel", "tuwemka", "mipity", "sahuldor", "dorcuvel", "bridor", "tyqua", "kakapi", "pivelcuhul", "hulhulmidor", "dor", "velgavelqua", "qua", "mirenbri"];
const writtenLarge = [
  "quasa", "gamibrifen", "misasatu", "tucucuqua", "tuwemwem", "kaka", "zovel", "kapi", "nexty", "jorga", "wemzotu", "jortyzoty", "wemtu", "cuka", "satu", "curenwemlo", "tytywem", "renwemlodor", "pilo", "wemkamifen",
  "cutycu", "pifen", "tydortypi", "fentu", "renbrifenga", "mivelnexren", "hultu", "tufendor", "bri", "sadorsazo", "gazovelhul", "mihulka", "wemfenfen", "tycunex", "renmi", "pilosa", "tuzopi", "tuwemtyjor", "gamipilo", "zomi",
  "kamipi", "mipi", "picutulo", "rensa", "losavel", "nextyvel", "fentysa", "hulkapi", "ka", "fenren", "quawembrity", "veldorga", "tubri", "lotuka", "pi", "salomibri", "cudornex", "sapi", "kapihulga", "dorlonex",
  "hulsa", "miquapity", "dorty", "mi", "mitubri", "nex", "dormijor", "quatunex", "loty", "tytutyty", "mika", "renbrifen", "quapi", "mipidor", "dorfen", "brimiquanex", "micu", "gapi", "cujortu", "renvelqua",
  "tynexfen", "fenrenwemvel", "miquaka", "fenmity", "pibrivelvel", "hultucu", "renhuldor", "quabrikasa", "brinextuzo", "brigaren", "kagaga", "renvelkanex", "hulmibri", "jormihulzo", "lopiren", "dorpi", "tygavelhul", "kabriwemwem", "milo", "fencutunex",
  "lowemtusa", "zoganexnex", "pibridor", "quawembri", "sa", "mivel", "wemdorfenga", "zotuwemvel", "misa", "wemmiga", "hulpi", "kazo", "zotyvelbri", "galoqua", "jorhultu", "zonexkatu", "zo", "jorquakami", "tyfenfendor", "tuty",
  "dorjor", "pity", "renrenminex", "bripi", "fenpiga", "quaty", "wemdor", "lokavel", "zomipidor", "huldorqualo", "kanex", "velnexveldor", "dorpinexren", "cusadorqua", "locutubri", "zolo", "fengarenmi", "gavel", "tyfen", "hulgafensa",
  "renwemvelbri", "nexzomi", "hulwem", "velgahulqua", "brilo", "lofenmilo", "velmicu", "hulpiga", "pinexka", "renqua", "bripizoqua", "cudor", "gafenhul", "brisa", "sazoren", "fensadortu", "fencudorwem", "pijorpi", "pipivel", "dorsadordor",
  "nexjor", "gami", "pidortyty", "renfen", "fenhul", "renlo", "cujor", "mihul", "fencu", "karencu", "vellohul", "tulovel", "locuvel", "hulsacunex", "mizorenbri", "wemmi", "nexnexzolo", "jorhulzo", "kahulvelbri", "velkazosa",
  "renmibrijor", "fensatu", "lo", "brimi", "tysatu", "nexsaty", "miren", "quavelnextu", "locubri", "dorcu", "cuvelquasa", "lobri", "brihul", "vello", "wemnexzonex", "zobri", "fentyfen", "fendorfencu", "saquabriren", "zohulmi",
  "tytylolo", "miga", "tukamicu", "quanex", "dormi", "cupisa", "cupifen", "veljorpicu", "gahul", "gabrisa", "rentylo", "fenwemty", "hulpibrihul", "hulga", "sacu", "nexjorga", "tunex", "zotyhullo", "quador", "nexrenty",
  "wemdorzo", "jortuvel", "cuquasa", "kador", "bripika", "cujorfen", "dorsakalo", "dorsa", "tuzo", "tycu", "cusatynex", "fenmifensa", "renpi", "loren", "pilopi", "typinexvel", "dorvelsa", "velbriga", "briwem", "quatykaka",
  "dorjornexvel", "cujormijor", "tulo", "velwemmi", "rendorvelvel", "quarentu", "gagazo", "kahulpi", "lohulga", "nexcukazo", "lowemjorvel", "sazoka", "nexlo", "renquasaqua", "typijor", "nexvel", "wemrengahul", "mizokahul", "nexpi", "wemtysabri",
  "tytufen", "safenfen", "jordortu", "fendorty", "cutyhul", "dorga", "piren", "renvel", "tutunexnex", "pivelrenren", "velbrifen", "zodortynex", "katupicu", "kadorzojor", "dorjordorsa", "gapirenzo", "zoquafen", "tysagaka", "quarenlopi", "savel",
  "renjorfen", "zofenvel", "brity", "lopipi", "brilokami", "zohuljorpi", "britydor", "fenvelsatu", "wemdortuhul", "fennexwemtu", "huldorpibri", "zosaqua", "dornexga", "quazocumi", "tunexbri", "tutyhul", "minex", "curenjor", "hultuvelbri", "cucu",
  "velquavel", "dortuquaqua", "tuquadorqua", "wemcu", "fenjorqua", "fenhulzo", "misahulka", "quatulovel", "tugarenhul", "quatywem", "zopiwem", "hulquabri", "typity", "velquaren", "velganex", "jormi", "wemjorlobri", "renkalo", "quacu", "cutucumi",
  "lofen", "tunexwem", "nexsazo", "jorbrifenmi", "quazo", "veltukazo", "rentu", "kapijordor", "salohultu", "fenpilolo", "nexcusa", "culogahul", "quasaturen", "sazoqua", "fenpijorga", "pilocu", "cukatu", "jorzodor", "bribricudor", "nexkagapi",
  "zosajor", "jortu", "wemquahul", "briveldornex", "velpijorka", "fenwemmiwem", "midorbri", "tygaqua", "velvel", "huljorjor", "britytu", "loqua", "renhulfen", "cukahul", "tycuka", "jorqua", "pipi", "renfenjorcu", "velsabri", "fenquami",
  "renmipiga", "mity", "safensahul", "lowemka", "lorentuga", "jorjorfen", "hulpibri", "brisafendor", "kafen", "losa", "tufenren", "kamifenga", "dorquaren", "tugador", "wemtufentu", "zozodor", "gasapi", "rengafenqua", "nexrenpivel", "zopidor",
  "renbri", "zosalo", "tukafen", "sahulzo", "pijor", "tusa", "pisaveltu", "jornex", "kami", "lotyhulga", "quamika", "quatupidor", "jorhul", "jorcuka", "tyfenty", "dorgabri", "tykatywem", "saren", "piwemka", "pika"];

let sum = 0;
function note(label, value) {
  sum = (sum * 31 + (value ? 7 : 3)) % 1000003;
  if (!note.quiet)
    console.log(label, value);
}
const ways = [
  text => text,
  text => text.slice(0, 1) + text.slice(1),
  text => (" " + text).slice(1),
  text => JSON.parse(JSON.stringify(text)),
  text => String.fromCharCode(...[...text].map(c => c.charCodeAt(0))),
  text => `${text}`,
  text => [text].join(""),
  text => text.split("").join(""),
];
// Asked by characters first: no constant of `large` has a cell yet.
note("made, before any constant", large.has(["renwemlodor", ""].join("")));
note("made and absent", large.has(["pilo", "x"].join("")));
note.quiet = true;
function askAll(name, table, present) {
  let right = 0, wrong = 0;
  for (const way of ways) {
    for (const text of present)
      table.has(way(text)) ? right++ : wrong++;
    for (const text of others)
      table.has(way(text)) ? wrong++ : right++;
  }
  for (let i = 0; i < 4000; i++)
    table.has("k" + i) ? wrong++ : right++;
  console.log(name, right, wrong);
}
for (let round = 0; round < 3; round++) {
  askAll("small", small, writtenSmall);
  askAll("medium", medium, writtenMedium);
  askAll("large", large, writtenLarge);
  askAll("prices", prices, writtenSmall);
}
// Through a function that knows nothing of what it is handed.
const ask = (table, key) => table.has(key);
let mixed = 0;
for (const table of [small, medium, large, prices, new Set(["tubrilo", 4]), new Map([[{ }, 1]])]) {
  for (const key of ["tubrilo", "wemsaren", "fencutunex", "renrenren", 4, null, undefined, 1.5, { }])
    mixed = mixed * 2 + (ask(table, key) ? 1 : 0) & 0xffffff;
}
console.log("mixed", mixed);
console.log("values", prices.get("hul"), prices.get(["ty"].join("")), prices.get("tydorfenren"));
// The first write moves the entries to the heap.
medium.delete("lojorrendor");
medium.add("rensalo");
large.add(12);
console.log("behind a write", medium.has("lojorrendor"), medium.has("rensalo"), medium.has("jor"), large.has("kaka"), large.has(12), large.has("renfenqua"));
askAll("medium, written to", medium, writtenMedium.slice(1));
