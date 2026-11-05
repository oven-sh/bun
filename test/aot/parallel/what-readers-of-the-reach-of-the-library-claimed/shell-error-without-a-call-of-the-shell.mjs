try { throw new Error("x"); } catch (error) { console.log(error instanceof Bun.$.ShellError); }
