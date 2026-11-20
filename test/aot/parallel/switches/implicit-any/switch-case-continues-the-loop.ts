// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// A case of the switch continues the loop, and the counter steps before the switch. The build stopped: an edge passed on an unboxed counter that only one loop version had computed.
function count(list, from, to) { let zeros = 0, i = from; while (i < to) { i += 1; switch (list[i]) { case 0: zeros++; continue; } zeros += 0; } return zeros + "/" + i; }
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
