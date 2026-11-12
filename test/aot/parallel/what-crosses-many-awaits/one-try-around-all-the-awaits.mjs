// Where the lists of what is alive across the awaits of a body are together longer than the body, what crosses several awaits has a word in the machine frame.
// The handler stands on the first block of the body too.
let counted = 0;
async function allInOneTry(seed, fails) {
  try {
    const v0 = (await seed) + 0;
    const v1 = (await seed) + 1;
    const v2 = (await seed) + 2;
    const v3 = (await seed) + 3;
    const v4 = (await seed) + 4;
    const v5 = (await seed) + 5;
    const v6 = (await seed) + 6;
    const v7 = (await seed) + 7;
    const v8 = (await seed) + 8;
    const v9 = (await seed) + 9;
    const v10 = (await seed) + 10;
    const v11 = (await seed) + 11;
    const v12 = (await seed) + 12;
    const v13 = (await seed) + 13;
    const v14 = (await seed) + 14;
    const v15 = (await seed) + 15;
    const v16 = (await seed) + 16;
    const v17 = (await seed) + 17;
    const v18 = (await seed) + 18;
    const v19 = (await seed) + 19;
    const v20 = (await seed) + 20;
    if (fails) throw new Error("at the middle " + v0 + " " + v20);
    const v21 = (await seed) + 21;
    const v22 = (await seed) + 22;
    const v23 = (await seed) + 23;
    const v24 = (await seed) + 24;
    const v25 = (await seed) + 25;
    const v26 = (await seed) + 26;
    const v27 = (await seed) + 27;
    const v28 = (await seed) + 28;
    const v29 = (await seed) + 29;
    const v30 = (await seed) + 30;
    const v31 = (await seed) + 31;
    const v32 = (await seed) + 32;
    const v33 = (await seed) + 33;
    const v34 = (await seed) + 34;
    const v35 = (await seed) + 35;
    const v36 = (await seed) + 36;
    const v37 = (await seed) + 37;
    const v38 = (await seed) + 38;
    const v39 = (await seed) + 39;
    return (
      v0 +
      v1 +
      v2 +
      v3 +
      v4 +
      v5 +
      v6 +
      v7 +
      v8 +
      v9 +
      v10 +
      v11 +
      v12 +
      v13 +
      v14 +
      v15 +
      v16 +
      v17 +
      v18 +
      v19 +
      v20 +
      v21 +
      v22 +
      v23 +
      v24 +
      v25 +
      v26 +
      v27 +
      v28 +
      v29 +
      v30 +
      v31 +
      v32 +
      v33 +
      v34 +
      v35 +
      v36 +
      v37 +
      v38 +
      v39
    );
  } catch (error) {
    return error.message + " " + typeof seed;
  } finally {
    counted++;
  }
}
console.log(
  await allInOneTry(1, false),
  await allInOneTry(2, true),
  await allInOneTry(Promise.reject(new Error("rejected")), false),
  counted,
);
