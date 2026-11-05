const say = process.argv.length > 9 ? console.error : console.log;
say(typeof console.Console, Bun.inspect(console).length > 50);
say(console.Console === undefined);
