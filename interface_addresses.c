#include <arpa/inet.h>
#include <ifaddrs.h>
#include <netdb.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#include "interface_adresses.h"

NetworkInterface *getNetworkInterfaces() {
    NetworkInterface *interfaces = (NetworkInterface*) malloc(sizeof(NetworkInterface));
    if (interfaces == NULL) return NULL;

    short interfacesIndex = -1;
    struct ifaddrs *ifap, *ifa;
    struct in6_addr in6addr;

    getifaddrs (&ifap);
    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        interfacesIndex++;
        if (interfacesIndex > 0)  {
            interfaces = (NetworkInterface*) realloc(interfaces, (interfacesIndex+1) * sizeof(NetworkInterface));
            if (interfaces == NULL) return NULL;
        }

        if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET) {
            struct sockaddr_in *sa = (struct sockaddr_in *) ifa->ifa_addr;
            char *addr = inet_ntoa(sa->sin_addr);
            char *interface_name = ifa->ifa_name;

            interfaces[interfacesIndex].address = (char*) malloc(strlen(addr)+1);
            if (interfaces[interfacesIndex].address == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].address, addr, strlen(addr));
            interfaces[interfacesIndex].address[strlen(addr)] = '\0';

            interfaces[interfacesIndex].interface = (char*) malloc(strlen(interface_name)+1);
            if (interfaces[interfacesIndex].interface == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].interface, addr, strlen(interface_name));
            interfaces[interfacesIndex].interface[strlen(interface_name)] = '\0';

            interfaces[interfacesIndex].family = (char*) malloc(strlen("IPv4")+1);
            memcpy(interfaces[interfacesIndex].family, addr, strlen("IPv4"));
            interfaces[interfacesIndex].family[strlen("IPv4")] = '\0';
        } else if (ifa->ifa_addr && ifa->ifa_addr->sa_family==AF_INET6) {
            struct sockaddr_in6 *sa = (struct sockaddr_in6 *) ifa->ifa_addr;
            char addr[INET6_ADDRSTRLEN];
            inet_ntop(AF_INET6, &in6addr, addr, sizeof(addr));
            char *interface_name = ifa->ifa_name;

            interfaces[interfacesIndex].address = (char*) malloc(strlen(addr)+1);
            if (interfaces[interfacesIndex].address == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].address, addr, strlen(addr));
            interfaces[interfacesIndex].address[strlen(addr)] = '\0';

            interfaces[interfacesIndex].interface = (char*) malloc(strlen(interface_name)+1);
            if (interfaces[interfacesIndex].interface == NULL) return NULL;
            memcpy(interfaces[interfacesIndex].interface, addr, strlen(interface_name));
            interfaces[interfacesIndex].interface[strlen(interface_name)] = '\0';

            interfaces[interfacesIndex].family = (char*) malloc(strlen("IPv6")+1);
            memcpy(interfaces[interfacesIndex].family, addr, strlen("IPv6"));
            interfaces[interfacesIndex].family[strlen("IPv6")] = '\0';
        }
    }
    freeifaddrs(ifap);

    interfacesIndex++;
    interfaces = (NetworkInterface*) realloc(interfaces, (interfacesIndex+1) * sizeof(NetworkInterface));
    if (interfaces == NULL) return NULL;
    interfaces[interfacesIndex] = (NetworkInterface) {NULL, NULL, NULL};

    return interfaces;
}

int getNetworkInterfaceArrayLen(NetworkInterface *arr) {
    int i = 0;
    for (; arr[i].address != NULL; i++);
    return i;
}