// STATISTIC: LoopNestsInterleaved >= 1
// A meadow is raked strip by strip: what the rake carries along a strip goes into each place of it. Some evenings the rake rests behind a strip, and the strips that are left keep what lies on them.
const WIDTH = 48;

function meadow(strips, seed) {
  const grass = new Array(strips * WIDTH).fill(0.5);
  for (let k = 0; k < grass.length; k++) grass[k] = ((k * seed) % 7) * 0.5 + 0.25;
  return grass;
}

function rakedWhole(grass) {
  const strips = (grass.length / WIDTH) | 0;
  for (let i = 0; i < strips; i++) {
    let carried = 0.75;
    let place = i * WIDTH;
    for (let j = 0; j < WIDTH; j++) {
      carried = (carried * 0.5 + grass[place] * 0.25 + 1.5) * 0.75 - carried * 0.125;
      grass[place] = carried;
      place++;
    }
  }
}

function rakedUntil(grass, evening) {
  const strips = (grass.length / WIDTH) | 0;
  let goesOn = true;
  for (let i = 0; i < strips; i++) {
    if (!goesOn) break;
    let carried = 0.75;
    let place = i * WIDTH;
    for (let j = 0; j < WIDTH; j++) {
      carried = (carried * 0.5 + grass[place] * 0.25 + 1.5) * 0.75 - carried * 0.125;
      grass[place] = carried;
      place++;
    }
    goesOn = i < evening;
  }
}

function rakedTillTired(grass, evening) {
  const strips = (grass.length / WIDTH) | 0;
  let isTired = false;
  for (let i = 0; i < strips; i++) {
    if (isTired) break;
    let carried = 0.25;
    let place = i * WIDTH;
    for (let j = 0; j < WIDTH; j++) {
      carried = (carried * 0.25 + grass[place] * 0.5 + 0.5) * 0.625 - carried * 0.25;
      grass[place] = carried;
      place++;
    }
    isTired = i >= evening;
  }
}

function rakedWhileLight(grass, evening) {
  let light = true;
  for (let i = 0; light; i++) {
    let carried = 0.75;
    let place = i * WIDTH;
    for (let j = 0; j < WIDTH; j++) {
      carried = (carried * 0.5 + grass[place] * 0.25 + 1.5) * 0.75 - carried * 0.125;
      grass[place] = carried;
      place++;
    }
    light = i < evening;
  }
}

function rakedByTwo(grass, evening, night) {
  const strips = (grass.length / WIDTH) | 0;
  let goesOn = true;
  let isLight = true;
  for (let i = 0; i < strips; i++) {
    if (!goesOn) break;
    if (!isLight) break;
    let carried = 0.75;
    let place = i * WIDTH;
    for (let j = 0; j < WIDTH; j++) {
      carried = (carried * 0.5 + grass[place] * 0.25 + 1.5) * 0.75 - carried * 0.125;
      grass[place] = carried;
      place++;
    }
    goesOn = i < evening;
    isLight = i * 2 < night;
  }
}

function told(grass) {
  let sum = 0;
  let said = "";
  for (let i = 0; i < grass.length; i++) sum += grass[i] * (i % 5 + 1);
  for (let i = 9; i < grass.length; i += WIDTH) said += " " + grass[i].toFixed(3);
  return sum.toFixed(6) + said;
}

for (let evening = 0; evening < 14; evening++) {
  for (const strips of [9, 13, 16]) {
    const whole = meadow(strips, 3);
    rakedWhole(whole);
    const until = meadow(strips, 3);
    rakedUntil(until, evening);
    const tired = meadow(strips, 5);
    rakedTillTired(tired, evening);
    const light = meadow(strips + 16, 3);
    rakedWhileLight(light, evening);
    const byTwo = meadow(strips, 2);
    rakedByTwo(byTwo, evening, 11);
    console.log(evening, strips, told(whole), told(until), told(tired), told(light), told(byTwo));
  }
}
