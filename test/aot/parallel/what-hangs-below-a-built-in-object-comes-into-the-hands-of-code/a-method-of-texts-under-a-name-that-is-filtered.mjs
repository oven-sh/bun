for (const name of Reflect.ownKeys(String.prototype).filter(name => typeof name === "string" && name.startsWith("pad")).sort()) console.log(name, "ab"[name](4, "-"));
