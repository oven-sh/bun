<script setup lang="ts">
const headers = useRequestHeaders(["x-asked-by"]);
const { data } = await useAsyncData("people", async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
  return [{ id: 1, name: "ada" }, { id: 2, name: "grace" }];
});
</script>
<template><main><h1>a page that awaits data</h1><p>asked by {{ headers["x-asked-by"] ?? "nobody" }}</p><ol><li v-for="person in data" :key="person.id">{{ person.name.toUpperCase() }}</li></ol></main></template>
