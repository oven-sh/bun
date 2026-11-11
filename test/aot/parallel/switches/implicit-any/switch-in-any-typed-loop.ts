// Under: --aot-check=Validate: the build stopped with UseNotDominated in every mode, so the verifier must accept this loop too
// Under: --aot-harden=proof-checks,ignore-told-ranges: the build stopped with UseNotDominated in every mode
// The same loop with every parameter typed `any`. The build stopped here too.
function count(list: any, from: any, to: any) {
  let zeros = 0, i = from;
  while (i < to) {
    switch (list[i]) { case 0: zeros++; }
    i += 1;
  }
  return zeros + "/" + i;
}
console.log(count(JSON.parse("[4,0,6]"), process.argv.length, 5));
