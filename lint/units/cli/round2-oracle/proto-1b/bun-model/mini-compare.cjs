// Compares the scratch mini-linter (records-based helpers, three rules) with ESLint over the fixtures of the tree and the TS case lists.
const fs=require("fs"),path=require("path"),{execFileSync}=require("child_process");
const {verify}=require("/workspace/notes/lint/units/cli/round2-oracle/proto-1b/eslint-side.cjs");
const RULES=["no-compare-neg-zero","valid-typeof","no-unsafe-negation","no-dupe-class-members","no-debugger","no-empty-pattern","no-sparse-arrays"];
const cases=[]; const seen=new Set();
const add=(code,ext,from)=>{const k=ext+":"+code; if(seen.has(k))return; seen.add(k); cases.push({code,ext,from});};
const fx="/workspace/wt/cli/test/cli/lint/rules";
for (const f of fs.readdirSync(fx).sort()) for (const c of JSON.parse(fs.readFileSync(path.join(fx,f),"utf8"))) add(c.code,c.ext||(c.jsx?"jsx":"js"),f.slice(0,-5));
const td="/workspace/notes/lint/units/cli/round2-oracle/proto-1b/cases";
for (const f of fs.readdirSync(td).sort()) for (const c of JSON.parse(fs.readFileSync(path.join(td,f),"utf8"))) add(c.code,c.ext,f.slice(3,-5)+"(ts-list)");
const dir="/tmp/lint-bun-model/cases"; fs.mkdirSync(dir,{recursive:true}); for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,f));
cases.forEach((c,i)=>{c.name=`c${String(i).padStart(5,"0")}.${c.ext}`; fs.writeFileSync(path.join(dir,c.name),c.code);});
let out="";
for (let i=0;i<cases.length;i+=500) out+=execFileSync((process.env.OUT || "/tmp/lint-bun-model/out") + "/tsprobe",cases.slice(i,i+500).map(c=>c.name),{cwd:dir,env:{...process.env,MINI:"1",ASAN_OPTIONS:"detect_leaks=0"},encoding:"utf8",maxBuffer:1<<28});
const by={}; let cur=null;
for (const l of out.split("\n")) { const m=/^== (\S+?): /.exec(l); if(m){cur=m[1];by[cur]={status:null,reports:[]};continue;} if(!cur)continue; if(/^ (OK|Err|init)/.test(l)&&!by[cur].status)by[cur].status=l.trim(); else { const r=/^R (\S+) (-?\d+) (.*)$/.exec(l); if(r)by[cur].reports.push({rule:r[1],offset:+r[2],message:r[3]}); } }
function lc(code,byteOffset){ const buf=Buffer.from(code,"utf8"); const text=buf.subarray(0,byteOffset).toString("utf8"); let line=1,col=1; for(let i=0;i<text.length;i++){const ch=text[i]; if(ch==="\r"){ if(text[i+1]==="\n")i++; line++;col=1;} else if(ch==="\n"||ch==="\u2028"||ch==="\u2029"){line++;col=1;} else col++;} return `${line}:${col}`; }
const t={cases:cases.length,bunRejects:0,eslintRejects:0,pairs:0,same:0,diff:0}; const diffs=[];
for (const c of cases) { const b=by[c.name]; if(!b||!/^OK/.test(b.status||"")){t.bunRejects++;continue;} const r=verify(c.code,c.ext,RULES); if(r.fatal){t.eslintRejects++;continue;}
  for (const rule of RULES) { const isUndef=m=>{const line=c.code.split(/\r\n|[\n\r\u2028\u2029]/)[m.line-1]||""; return /^(undefined|\\u0075ndefined)/.test(line.slice(m.column-1));}; const theirs=[...new Set(r.messages.filter(m=>m.ruleId===rule&&!(rule==="valid-typeof"&&isUndef(m))).map(m=>`${m.line}:${m.column} ${m.message}`))].sort(); const ours=[...new Set(b.reports.filter(x=>x.rule===rule).map(x=>`${lc(c.code,x.offset)} ${x.message}`))].sort(); if(!theirs.length&&!ours.length)continue; t.pairs++; if(JSON.stringify(theirs)===JSON.stringify(ours))t.same++; else {t.diff++; diffs.push(`[${rule}] ${JSON.stringify(c.code)} [${c.ext}] from ${c.from}\n    eslint: ${theirs.join(" | ")||"(none)"}\n    mini:   ${ours.join(" | ")||"(none)"}`);} } }
console.log(JSON.stringify(t)); for (const d of diffs.slice(0,+(process.argv[2]||60))) console.log(d);
