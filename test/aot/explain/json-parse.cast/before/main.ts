interface Config {
  host: string;
  port: number;
}

const config = JSON.parse('{"host":"localhost","port":3000}') as Config;
console.log(config.host + ":" + config.port);
