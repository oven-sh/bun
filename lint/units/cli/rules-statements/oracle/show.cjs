const rl=require("readline").createInterface({input:process.stdin});
const max = Number(process.argv[2]||200);
rl.on("line",l=>{const o=JSON.parse(l);console.log((o.kind==="valid"?"V":"I")+" ["+o.type+(o.jsx?" jsx":"")+(o.skip?" SKIP:"+o.skip:"")+(o.given?" given="+o.given:"")+"] "+JSON.stringify(o.code).slice(0,max)+(o.fatal?"  FATAL "+o.fatal:"")+"\n      => "+(o.reports.join(" | ")||"(none)"))});
