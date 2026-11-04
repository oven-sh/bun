// A list of keys gets an element far past its end, which makes its storage sparse, and is then read with at(). The function is called through a list of functions.
function second() { const a: any = Object.keys({ k: 1 }); a[5000] = "far"; return a.at(0); }
for (const f of [second]) console.log(f());
