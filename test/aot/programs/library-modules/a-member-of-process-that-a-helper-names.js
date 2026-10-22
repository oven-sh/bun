// `process` is handed to a function, stored in an object and in an array, and returned. Whoever gets it finds the member it reads.
function write(target, text) {
  target.stdout.write(text);
}
write(process, "a property of a parameter\n");
const holder = { it: process };
const { stderr } = holder.it;
console.log(typeof stderr.write);
for (const name of ["stdin"]) console.log(typeof [process][0][name].on);
const give = () => process;
console.log(typeof give().allowedNodeEnvironmentFlags.has);
