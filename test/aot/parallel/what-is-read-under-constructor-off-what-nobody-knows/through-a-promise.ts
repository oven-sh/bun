function later(given: any): Promise<any> {
  return Promise.resolve(given.constructor);
}
later(JSON.parse("9")).then(kept => console.log(String(kept("17"))));
