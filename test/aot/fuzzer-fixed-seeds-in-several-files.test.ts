// As fuzzer-fixed-seeds.test.ts, a third as many programs, each in several files: the declarations at the top of a program lie in files of their own, which import from each other. Some of the files
// are JavaScript, with or without declaration files that say too little or are not valid; some are packages; some say too little in their own annotations (fuzz/sources.ts laidIntoFiles()).
import { inSeveralFiles } from "./fuzz/sources";
import { printTheSame } from "./fuzzer-fixed-seeds";

printTheSame(1 / 3, inSeveralFiles);
