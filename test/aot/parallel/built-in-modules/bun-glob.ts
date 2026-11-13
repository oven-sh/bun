console.log(new Bun.Glob("*.ts").match("a.ts"), new Bun.Glob("*.ts").match("a.js"));

export {};
