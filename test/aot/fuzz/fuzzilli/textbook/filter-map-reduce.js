function worth(items) {
  return items
    .filter(item => item.count > 0)
    .map(item => item.count * item.price)
    .reduce((sum, one) => sum + one, 0);
}
console.log(worth(JSON.parse('[{"count":2,"price":3},{"count":0,"price":9},{"count":1,"price":4}]')));
