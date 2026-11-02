try {
  await new Response(
    new ReadableStream({
      start(c) {
        c.error(new WritableStream());
      },
    }),
  ).text();
} catch (error) {
  console.error(error);
}
