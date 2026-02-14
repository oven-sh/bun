/* Copyright (C) 2018 TeselaGen Biotechnology, Inc. */

console.log("Process Title:", process.title);
console.log("Arguments:", process.argv);

process.title = "zzz_temp_title";

setInterval(() => {
  console.log("Process is still running...");
  console.log("Process Title:", process.title);
}, 1000);
