for (let i = 0; i < 100; i++) {
  const response = await fetch("http://example.com");
  await response.text();
}
