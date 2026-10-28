<script setup lang="ts">
const { data } = await useFetch("/api/hello", { query: { name: "the server itself" } });
const { data: squared } = await useFetch("/api/validated", { query: { n: 12 } });
</script>
<template><p>fetched while rendering: {{ JSON.stringify(data) }} and {{ JSON.stringify(squared) }}</p></template>
