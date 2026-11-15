// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// The loop is in an async function. The build stopped: the fallback version compared an unboxed bound that only one loop version had computed.
async function count(list, from, to) { let zeros = 0, i = from; while (i < to) { switch (list[i]) { case 0: zeros++; } i += 1; } return zeros + "/" + i; }
count(JSON.parse("[4,0,6]"), process.argv.length, 5).then((v) => console.log(v));
