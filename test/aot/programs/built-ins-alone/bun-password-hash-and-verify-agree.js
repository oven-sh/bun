const hash = Bun.password.hashSync("secret", { algorithm: "bcrypt", cost: 4 });
console.log(typeof hash, Bun.password.verifySync("secret", hash), Bun.password.verifySync("other", hash));
