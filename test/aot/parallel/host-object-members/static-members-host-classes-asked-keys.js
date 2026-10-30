// The classes are named, their static members are not: each key is put together while the program runs.
// Every member is there in each way of asking, and each way is the first to ask for some of them.

const rows = [
  [Response, "ktpo,fssps,sfejsfdu"],
  [Request, ""],
  [Blob, ""],
  [File, ""],
  [Headers, ""],
  [FormData, ""],
  [URL, "dboQbstf,qbstf,dsfbufPckfduVSM,sfwplfPckfduVSM"],
  [URLSearchParams, ""],
  [AbortSignal, "bcpsu,ujnfpvu,boz"],
  [AbortController, ""],
  [Event, "OPOF,DBQUVSJOH`QIBTF,BU`UBSHFU,CVCCMJOH`QIBTF"],
  [WebSocket, "DPOOFDUJOH,PQFO,DMPTJOH,DMPTFE"],
  [DOMException, "JOEFY`TJ[F`FSS,BCPSU`FSS,EBUB`DMPOF`FSS"],
  [PerformanceObserver, "tvqqpsufeFouszUzqft"],
  [ReadableStream, "gspn"],
  [Buffer, "bmmpd,bmmpdVotbgf,czufMfohui,dpnqbsf,dpodbu,gspn,jtCvggfs,jtFodpejoh,qppmTj{f"],
  [Promise, "sftpmwf,sfkfdu,bmm,bmmTfuumfe,boz,sbdf,xjuiSftpmwfst,usz"],
];

function decode(text) {
  let key = "";
  for (let i = 0; i < text.length; i++) key += String.fromCharCode(text.charCodeAt(i) - 1);
  return key;
}

function show(description) {
  if (!description) return "absent";
  const kind = description.get || description.set ? "accessor" : typeof description.value;
  return [kind, description.writable, description.enumerable, description.configurable].join("|");
}

const ways = [
  (holder, key) => show(Object.getOwnPropertyDescriptor(holder, key)),
  (holder, key) => show(Reflect.getOwnPropertyDescriptor(holder, key)),
  (holder, key) => show(Object.getOwnPropertyDescriptors(holder)[key]),
  (holder, key) => Object.hasOwn(holder, key),
  (holder, key) => Object.prototype.hasOwnProperty.call(holder, key),
  (holder, key) => key in holder,
  (holder, key) => Reflect.has(holder, key),
  (holder, key) => Object.keys(holder).includes(key),
  (holder, key) => Object.getOwnPropertyNames(holder).includes(key),
  (holder, key) => Reflect.ownKeys(holder).includes(key),
  (holder, key) => Object.prototype.propertyIsEnumerable.call(holder, key),
  (holder, key) => typeof holder[key],
  (holder, key) => typeof Reflect.get(holder, key),
  (holder, key) => typeof { ...holder }[key],
];

let first = 0;
for (const [holder, texts] of rows) {
  for (const text of ("obnf,mfohui,qspupuzqf," + texts).split(",")) {
    if (!text) continue;
    const key = decode(text);
    const answers = new Array(ways.length);
    for (let turn = 0; turn < ways.length; turn++) {
      const way = (first + turn) % ways.length;
      answers[way] = ways[way](holder, key);
    }
    first++;
    console.log(holder.name + "." + key, answers.join(" "));
  }
}
