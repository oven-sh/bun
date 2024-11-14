interface User {
  id: number;
  name: string;
}

const userFromSomeAPI = JSON.parse('{"id": 1}') as User;

const uppercaseFirst = userFromSomeAPI.name.charAt(0).toUpperCase() + userFromSomeAPI.name.slice(1);

console.log(uppercaseFirst);
