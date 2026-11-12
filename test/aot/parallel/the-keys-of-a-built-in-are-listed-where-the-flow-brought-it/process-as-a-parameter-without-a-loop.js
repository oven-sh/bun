function walked(object) {
  let seen = false;
  for (const key in object) {
    if (key === "_eventsCount") seen = true;
  }
  return seen;
}
console.log(walked(process), walked(process), "_eventsCount" in process);
