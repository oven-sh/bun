// JSON.stringify is redefined and put back, so a read of it is no constant. An async generator is stepped between the read and the call.
// Flags: --aot-check=verify-each-pass
const original = Object.getOwnPropertyDescriptor(JSON, "stringify");
const put = value => Object.defineProperty(JSON, "stringify", { value, writable: true, configurable: true });
const restore = () => Object.defineProperty(JSON, "stringify", original);
async function* takes(log) {
  let sent = yield 1;
  log.push("sent " + sent);
  try {
    sent = yield "two";
    log.push("sent " + sent);
  } catch (error) {
    log.push("caught " + error.message);
    sent = yield { three: 3 };
  }
  return sent;
}
async function redefinedBetweenRounds() {
  for (let round = 0; round < 9; round++) {
    for (const how of ["return", "throw", "next"]) {
      const log = [];
      const generator = takes(log);
      let text = "";
      if (round % 3 === 1) put(value => "replaced " + typeof value + " " + Object.keys(value));
      else if (round % 3 === 2) restore();
      try {
        text += JSON.stringify(await generator.next());
      } catch (error) {
        text += "threw " + error.message;
      }
      try {
        text += JSON.stringify(
          await (how === "return"
            ? generator.return("R")
            : how === "throw"
              ? generator.throw(new Error("T"))
              : generator.next("N")),
        );
      } catch (error) {
        text += "threw " + error.message;
      }
      try {
        text += JSON.stringify(await generator.next());
      } catch (error) {
        text += "threw " + error.message;
      }
      try {
        text += JSON.stringify(await generator.next(round));
      } catch (error) {
        text += "threw " + error.message;
      }
      console.log(round + " | " + how + ": " + text + " | " + log.join(" "));
    }
  }
  restore();
}
async function* redefines(round) {
  if (round & 1) put(value => "replaced " + typeof value);
  yield round;
  restore();
  await null;
  yield Promise.resolve("later " + round);
  if (round & 2) throw new RangeError("ended " + round);
  return {
    then(resolve) {
      resolve("thenable " + round);
    },
  };
}
async function redefinedByTheGenerator() {
  for (let round = 0; round < 8; round++) {
    const generator = redefines(round);
    const early = round & 4 ? [generator.next(), generator.next()] : [];
    let text = "";
    for (let step = 0; step < 4; step++) {
      try {
        text += JSON.stringify(await generator.next()) + " ";
      } catch (error) {
        text += "threw " + error.message + " ";
      }
    }
    for (const each of early) {
      try {
        text += JSON.stringify(await each) + " ";
      } catch (error) {
        text += "threw " + error.message + " ";
      }
    }
    console.log(round + ": " + text);
  }
}
redefinedBetweenRounds().then(redefinedByTheGenerator);
