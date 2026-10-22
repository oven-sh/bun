import { stdout, stderr, argv, env, cwd, nextTick } from "node:process";
nextTick(() => stdout.write("tick\n"));
stdout.write([stdout === process.stdout, stderr === process.stderr, argv === process.argv, env === process.env, typeof cwd()].join() + "\n");
