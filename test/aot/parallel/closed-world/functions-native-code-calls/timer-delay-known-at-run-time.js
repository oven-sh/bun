// functions-native-code-calls/timer-delays-that-do-not-fit with a delay that the compiler cannot know.
// The printed line names the process id and the executable, which differ from run to run.
process.pid = 1;
process.argv0 = "program";
// Far apart: the second timer is due first unless the machine stalls between the two calls for as long as the first delay.
const delays = [250, -5];
for (const delay of delays) setTimeout(() => console.log("after " + delay), delay);
