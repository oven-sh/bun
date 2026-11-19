<script setup lang="ts">
const route = useRoute();
const id = String(route.params.id);
if (!/^\d+$/.test(id)) throw createError({ statusCode: 404, statusMessage: "no such person", fatal: true });
useHead({ title: "person " + id });
</script>
<template><p>person {{ id }}, doubled {{ Number(id) * 2 }}, greeted with {{ route.query.greeting ?? "nothing" }}</p></template>
