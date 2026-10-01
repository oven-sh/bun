// usage: bun stdout-lost-on-shared-pipe.ts 2>&1 | wc -c     (500001 bytes are written; 4393 arrived with bun 1.4.3-canary.1+367d939d9)
//        bun stdout-lost-on-shared-pipe.ts 2>/dev/null | wc -c    (500001 arrive)
// What sweep.ts does in short: it reads process.stderr (its onResult asks process.stderr.isTTY), prints with console.log and ends with process.exit. Where stdout and stderr are one pipe, the text that the pipe does not take at once is lost at the exit; into a file (> out.txt 2>&1) nothing is lost.
if (!process.stderr.isTTY) console.error("progress");
console.log("x".repeat(500000));
process.exit(0);
