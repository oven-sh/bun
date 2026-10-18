interface Config {
  host: string;
  port: number;
}

const config = JSON.parse<Config>('{"host":"localhost","port":3000}');
console.log(config.host + ":" + config.port);
