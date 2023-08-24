---
name: Hash a password
---

The `Bun.password.hash()` function provides a fast, built-in mechanism for securely hashing passwords in Bun. No third-party dependencies are required.

```ts
const password = "super-secure-pa$$word";

const hash = await Bun.password.hash(password);
// => $argon2id$v=19$m=65536,t=2,p=1$tFq+9AVr1bfPxQdh6E8DQRhEXg/M/...
```

---

By default this uses the [Argon2id](https://en.wikipedia.org/wiki/Argon2) algorithm. Pass a second argument to `Bun.hash.password()` to use a different algorithm or configure the hashing parameters.

```ts
const password = "super-secure-pa$$word";

// use argon2 (default)
const argonHash = await Bun.password.hash(password, {
  memoryCost: 4, // memory usage in kibibytes
  timeCost: 3, // the number of iterations
});
```

---

Bun also implements the [bcrypt](https://en.wikipedia.org/wiki/Bcrypt) algorithm. Specify `algorithm: "bcrypt"` to use it.

```ts
// use bcrypt
const bcryptHash = await Bun.password.hash(password, {
  algorithm: "bcrypt",
  cost: 4, // number between 4-31
});
```

---

To verify a password, use `Bun.password.verify()`. The algorithm and its parameters are stored in the hash itself, so there's no need to re-specify any configuration.

```ts
const password = "super-secure-pa$$word";
const hash = await Bun.password.hash(password);

const isMatch = await Bun.password.verify(password, hash);
// => true
```

---

See [Docs > API > Hashing](/docs/api/hashing#bun-password) for complete documentation.
