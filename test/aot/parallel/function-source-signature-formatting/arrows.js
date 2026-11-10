const forms = [
  c => c, c=>c, async c => c, async c=>c, async   c   =>   c, $ => $, _a1 => _a1, async => async, (c) => c, (  c  )   =>   c, async(c)=>c, async ( c ) => c,
  ()=>1, ( )=>1, async()=>1, (a,)=>a, (a,b,)=>a, (a , b)=>a, (a /* first */, b /* second */) => a, (/* none */) => 1, (a, // first
    b) => a, (
    a,
    b,
  ) => a, x =>
    x, x => /* the answer */ x, x /* the name */ => x,
  (a=1,b=a)=>a, (a = 1 /* one */, b = "//" /* no comment */) => a, (a = /[)]/ )=>a, (a = ")" )=>a, (a = b=>b )=>a, (a = (b)=>b , c = d => d)=>a,
  (...r)=>r, ( ... r )=>r, (a,...r)=>a, (a,...[b,c])=>a,
  c => d => e => c, c => (d) => c, (c) => d => c,
];
for (const form of forms) console.log(JSON.stringify(String(form)));
