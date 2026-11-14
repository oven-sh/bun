// process.stdout is a stream of node:fs. Only a program that loads node:fs/promises has a FileHandle for such a stream: nothing of that module is compiled here.
// STATISTIC: ImageFunctionsEmitted <= 1950
process.stdout.write("one\n");
