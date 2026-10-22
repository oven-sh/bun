// functions-native-code-calls/unhandled-rejection-as-a-warning with a promise that native code makes and rejects. The program has no other promise and names none.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
Bun.password.verify("password", "not a hash");
setTimeout(() => console.log("still running"), 50);
