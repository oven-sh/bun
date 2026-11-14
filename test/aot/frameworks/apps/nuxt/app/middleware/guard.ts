export default defineNuxtRouteMiddleware(to => {
  if (to.query.pass !== "yes") return navigateTo("/data", { redirectCode: 303 });
});
