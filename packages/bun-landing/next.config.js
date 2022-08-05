module.exports = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    // support shiki top level await
    config.experiments = { ...config.experiments, ...{ topLevelAwait: true }};
    return config;
  },
};
