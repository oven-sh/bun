process.setUncaughtExceptionCaptureCallback(error => {
  console.log(typeof error, error.code + 1);
});
setTimeout(() => {
  throw { code: 1.5 };
}, 0);
