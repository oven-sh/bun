// As job-queued-by-tick-after-imported-cjs, but the imported file ends with an error that nothing catches. Plain Bun prints the same lines; its error names the path on disk.
export { first } from "./file.cjs";
/* Output:
awaits-thenable resumes
awaits-tick 1
awaits-tick 2
exit code 1
TypeError: require() async module "/$bunfs/root/modules/job-queued-by-tick-after-imported-cjs-throws/awaits-thenable.mjs" is unsupported. use "await import()" instead.
*/
