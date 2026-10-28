for (const index of [Number(process.argv.length > 99), Number(process.argv.length < 99)]) {
  console.log([Object.keys, Proxy.revocable][index]({}, {}).length);
}
