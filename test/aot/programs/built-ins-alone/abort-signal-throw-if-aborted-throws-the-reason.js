try {
  AbortSignal.abort({ code: 1.5 }).throwIfAborted();
} catch (error) {
  console.log(error.code + 1);
}
