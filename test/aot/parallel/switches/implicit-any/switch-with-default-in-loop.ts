// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// Under: --aot-harden=proof-checks,ignore-told-ranges: the build stopped with UseNotDominated in every mode
// The same loop with two cases and a default. The build stopped here too.
function count(list, from, to) {
  let zeros = 0, i = from;
  while (i < to) {
    switch (list[i]) { case 0: zeros++; break; case 6: zeros += 10; break; default: zeros += 100; }
    i += 1;
  }
  return zeros + "/" + i;
}
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
