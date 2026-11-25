const answer = process.on("exit", () => {});
process.stdout.write(String(answer === process) + " " + typeof answer.stdout.once + " " + typeof answer.stdout.cork + "\n");
